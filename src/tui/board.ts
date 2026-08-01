import { spawnSync } from "node:child_process";
import type { Args } from "../lib/args.js";
import { type Board, readActive, requireBoard, writeActive } from "../lib/board.js";
import {
  type LogEntry,
  appendLog,
  detectAuthor,
  kindLabel,
  openQuestionEntries,
  parseInput,
  readLog,
  shortDate,
  supersededIds,
  validate,
} from "../lib/log.js";
import { withLock } from "../lib/lock.js";
import { type RelatedResult, related } from "../lib/related.js";
import { type Hit, search } from "../lib/search.js";
import { writeSection } from "../lib/sections.js";
import { type Task, createTask, listTasks, today, writeTask } from "../lib/task.js";
import { bold, cyan, dim, green, magenta, red, truncate, wrapText, yellow } from "../lib/ui.js";
import { type App, type Host, type Key, pad, run, visLen } from "./screen.js";

type View = "list" | "detail" | "search" | "related" | "help";

interface Prompt {
  label: string;
  value: string;
  hint?: string;
  onSubmit: (value: string) => void;
}

interface Row {
  task: Task;
  entries: LogEntry[];
  deadEnds: number;
  questions: number;
}

const GLYPH: Record<string, string> = { open: "○", doing: "▶", done: "✓" };

class BoardApp implements App {
  private board: Board;
  private view: View = "list";
  private rows: Row[] = [];
  private cursor = 0;
  private scroll = 0;
  private showDone = true;
  private activeId: string | null = null;
  private detail: Task | null = null;
  private detailScroll = 0;
  private prompt: Prompt | null = null;
  private message = "";
  private messageKind: "info" | "error" = "info";
  private hits: Hit[] = [];
  private query = "";
  private relatedResult: RelatedResult | null = null;
  /** Flattened selection order for the related view, so enter opens the row the
   * cursor is actually on rather than a leftover search hit. */
  private relatedRows: Task[] = [];
  private host: Host | null = null;

  constructor(board: Board) {
    this.board = board;
    this.reload();
  }

  attach(host: Host): void {
    this.host = host;
  }

  private reload(keepId?: string): void {
    const id = keepId ?? this.rows[this.cursor]?.task.id;
    this.activeId = readActive(this.board);
    const all = listTasks(this.board);
    const visible = all.filter((t) => this.showDone || t.status !== "done");
    visible.sort(rank(this.activeId));
    this.rows = visible.map((task) => {
      const entries = readLog(this.board, task.id);
      const superseded = supersededIds(entries);
      return {
        task,
        entries,
        deadEnds: entries.filter((e) => e.kind === "dead-end" && !superseded.has(e.id)).length,
        questions: openQuestionEntries(entries).length,
      };
    });
    const found = id ? this.rows.findIndex((r) => r.task.id === id) : -1;
    this.cursor = found >= 0 ? found : Math.min(this.cursor, Math.max(0, this.rows.length - 1));
    if (this.detail) this.detail = this.rows.find((r) => r.task.id === this.detail?.id)?.task ?? null;
  }

  private say(text: string, kind: "info" | "error" = "info"): void {
    this.message = text;
    this.messageKind = kind;
  }

  private current(): Row | null {
    return this.rows[this.cursor] ?? null;
  }

  // ---------- render ----------

  render(width: number, height: number): string[] {
    const lines: string[] = [];
    lines.push(this.header(width));
    lines.push(dim("─".repeat(width)));

    const bodyHeight = Math.max(1, height - 4);
    const body =
      this.view === "help"
        ? this.helpBody()
        : this.view === "detail"
          ? this.detailBody(width, bodyHeight)
          : this.view === "search"
            ? this.searchBody(width)
            : this.view === "related"
              ? this.relatedBody(width)
              : this.listBody(width, bodyHeight);

    for (let i = 0; i < bodyHeight; i++) lines.push(body[i] ?? "");
    lines.push(this.statusLine(width));
    lines.push(this.keyBar());
    return lines;
  }

  private header(width: number): string {
    const left = `${bold("cairns")} ${dim(this.board.root)}`;
    const active = this.activeId ? `${green("▶")} ${this.activeId}` : dim("no active task");
    const gap = Math.max(1, width - visLen(left) - visLen(active));
    return left + " ".repeat(gap) + active;
  }

  private statusLine(width: number): string {
    if (this.prompt) {
      const p = this.prompt;
      const hint = p.hint ? dim(`  ${p.hint}`) : "";
      return `${cyan(p.label)} ${p.value}${bold("▌")}${hint}`;
    }
    if (this.message) return this.messageKind === "error" ? red(this.message) : dim(this.message);
    return dim("─".repeat(width));
  }

  private keyBar(): string {
    if (this.prompt) return dim("enter submit · esc cancel");
    if (this.view === "detail") return dim("j/k scroll · e log · a ask · E edit · s start · D done · esc back · q quit");
    if (this.view === "search" || this.view === "related") return dim("j/k move · enter open · / new search · esc back · q quit");
    if (this.view === "help") return dim("esc back");
    return dim("j/k move · enter open · n new · s start · e log · E edit · D done · / search · r related · h all · ? help · q quit");
  }

  private listBody(width: number, height: number): string[] {
    if (!this.rows.length) {
      return ["", dim("  no tasks yet — press n to capture one")];
    }
    this.scroll = clampScroll(this.cursor, this.scroll, height);
    const out: string[] = [];
    for (let i = this.scroll; i < Math.min(this.rows.length, this.scroll + height); i++) {
      const r = this.rows[i]!;
      const t = r.task;
      const selected = i === this.cursor;
      const glyph = t.status === "done" ? green(GLYPH.done!) : t.status === "doing" ? yellow(GLYPH.doing!) : dim(GLYPH.open!);
      const id = t.id === this.activeId ? bold(cyan(t.id)) : dim(t.id);
      const badges: string[] = [];
      if (r.deadEnds) badges.push(yellow(`${r.deadEnds}✗`));
      if (r.questions) badges.push(magenta(`${r.questions}?`));
      if (r.entries.length) badges.push(dim(`${r.entries.length}·`));
      const right = badges.join(" ");
      const titleWidth = Math.max(10, width - 4 - visLen(id) - visLen(right) - 4);
      const title = t.status === "done" ? dim(truncate(t.title, titleWidth)) : truncate(t.title, titleWidth);
      const line = ` ${glyph} ${id}  ${title}`;
      const gap = Math.max(1, width - visLen(line) - visLen(right) - 1);
      const full = line + " ".repeat(gap) + right;
      out.push(selected ? highlight(full, width) : full);
    }
    return out;
  }

  private detailBody(width: number, height: number): string[] {
    const t = this.detail;
    if (!t) return [dim("  task no longer exists")];
    const w = Math.min(width - 4, 100);
    const out: string[] = [];
    out.push(` ${bold(t.title)}`);
    out.push(dim(`  ${t.id} · ${t.status}${t.closed ? ` · closed ${t.closed}` : ""} · updated ${t.updated}`));
    out.push("");

    if (t.doneWhen.length) {
      out.push(`  ${bold("done when")}`);
      for (const l of t.doneWhen) for (const w2 of wrapText(l, w, "    - ")) out.push(w2);
    } else {
      out.push(yellow("  done when: (none set — completion cannot be verified)"));
    }
    if (t.targets.length) out.push(dim(`  targets: ${t.targets.join(", ")}`));
    out.push("");

    if (t.context.trim()) {
      out.push(`  ${bold("context")}`);
      for (const l of wrapText(t.context, w, "    ")) out.push(l);
      out.push("");
    }
    if (t.outcome.trim()) {
      out.push(`  ${green(bold("outcome"))}`);
      for (const l of wrapText(t.outcome, w, "    ")) out.push(l);
      out.push("");
    }
    for (const n of t.notes) out.push(dim(`  note: ${n}`));

    const entries = readLog(this.board, t.id);
    const superseded = supersededIds(entries);
    const open = new Set(openQuestionEntries(entries).map((e) => e.id));
    out.push(`  ${bold("log")} ${dim(`(${entries.length})`)}`);
    if (!entries.length) out.push(dim("    nothing recorded"));
    for (const e of [...entries].reverse()) {
      out.push(...entryLines(e, w, superseded.has(e.id), open.has(e.id)));
    }

    this.detailScroll = Math.max(0, Math.min(this.detailScroll, Math.max(0, out.length - height)));
    return out.slice(this.detailScroll, this.detailScroll + height);
  }

  private searchBody(width: number): string[] {
    const out: string[] = [];
    out.push(dim(`  search: ${this.query || "(none)"} — ${this.hits.length} hit${this.hits.length === 1 ? "" : "s"}`));
    out.push("");
    if (!this.hits.length) {
      out.push(dim("  nothing matched. that means nothing was recorded, not that nothing happened."));
      return out;
    }
    this.hits.forEach((h, i) => {
      const sel = i === this.cursor;
      const head = ` ${dim(h.task.id)} ${h.entry ? yellow(kindLabel(h.entry.kind)) : dim("task")}  ${truncate(h.text, Math.max(20, width - 26))}`;
      out.push(sel ? highlight(head, width) : head);
      out.push(dim(`     ${h.task.status === "done" ? "closed" : "open"} · ${h.task.title}`));
    });
    return out;
  }

  private relatedBody(width: number): string[] {
    const r = this.relatedResult;
    if (!r) return [];
    const out: string[] = [`  ${bold(r.path)}`, ""];
    this.relatedRows = [...r.closed, ...r.open].map((row) => row.task);
    if (r.empty) {
      out.push(dim("  no tasks recorded against this path."));
      if (!r.hooksInstalled) {
        out.push("");
        out.push(yellow("  ⚠ no cairns commit hooks in this clone, so attribution is unavailable."));
        out.push(yellow('    this result means "unknown", not "nothing".'));
      }
      return out;
    }
    let index = 0;
    for (const group of [
      { label: "closed", rows: r.closed },
      { label: "open", rows: r.open },
    ]) {
      for (const row of group.rows) {
        const head = ` ${dim(row.task.id)} ${group.label === "closed" ? green("closed") : yellow("open")}  ${truncate(row.task.title, Math.max(20, width - 30))}`;
        out.push(index === this.cursor ? highlight(head, width) : head);
        index++;
        if (row.method === "targets") out.push(dim("     (via declared targets, not commits)"));
        if (row.method === "linked") out.push(dim("     (via backfilled commits, not trailers)"));
        for (const f of row.findings) {
          out.push(dim(`     ${kindLabel(f.kind)}: `) + truncate(f.text, Math.max(20, width - 20)));
          if (f.mechanism) out.push(dim(`       mechanism: ${f.mechanism}`));
        }
        out.push("");
      }
    }
    return out;
  }

  private helpBody(): string[] {
    return [
      `  ${bold("navigation")}`,
      "    j / k / ↑ / ↓    move            g / G    top / bottom",
      "    enter            open task       esc      back",
      "    h                toggle done tasks",
      "",
      `  ${bold("record")}`,
      "    n    new task",
      "    E    open the task file in $EDITOR",
      "    e    log entry     (prefix with 'decided:' / 'dead end:' / 'note:')",
      "    a    ask a question on this task",
      "    s    start (sets active, commits get a Task: trailer)",
      "    x    clear the active task",
      "    D    close with an outcome",
      "",
      `  ${bold("retrieve")}`,
      "    /    search logs and closed tasks",
      "    r    what to know before editing a path",
      "",
      dim("  a 'decided' or 'dead end' entry needs a mechanism, not a verdict."),
      dim("  if you do not know it, write 'mechanism: unknown' and attach evidence."),
    ];
  }

  // ---------- input ----------

  onKey(key: Key): boolean {
    this.message = "";
    if (this.prompt) return this.promptKey(key);

    if (key.name === "q") return false;
    if (key.name === "?") {
      this.view = this.view === "help" ? "list" : "help";
      return true;
    }
    if (key.name === "escape" || (key.name === "h" && this.view !== "list")) {
      this.view = "list";
      return true;
    }
    if (this.view === "detail") return this.detailKey(key);
    if (this.view === "help") return true;
    return this.listKey(key);
  }

  private promptKey(key: Key): boolean {
    const p = this.prompt!;
    if (key.name === "escape") {
      this.prompt = null;
      this.say("cancelled");
      return true;
    }
    if (key.name === "enter") {
      this.prompt = null;
      const value = p.value.trim();
      if (value) p.onSubmit(value);
      else this.say("cancelled — nothing entered");
      return true;
    }
    if (key.name === "backspace") {
      p.value = p.value.slice(0, -1);
      return true;
    }
    if (key.ctrl && key.name === "u") {
      p.value = "";
      return true;
    }
    if (key.ch) p.value += key.ch;
    return true;
  }

  private move(delta: number, max: number): void {
    this.cursor = Math.max(0, Math.min(max - 1, this.cursor + delta));
  }

  private listKey(key: Key): boolean {
    const n =
      this.view === "list"
        ? this.rows.length
        : this.view === "related"
          ? this.relatedRows.length
          : this.hits.length;
    switch (key.name) {
      case "j":
      case "down":
        this.move(1, n);
        return true;
      case "k":
      case "up":
        this.move(-1, n);
        return true;
      case "pagedown":
        this.move(10, n);
        return true;
      case "pageup":
        this.move(-10, n);
        return true;
      case "g":
        this.cursor = 0;
        return true;
      case "G":
        this.cursor = Math.max(0, n - 1);
        return true;
      case "enter":
      case "right":
      case "l":
        return this.open();
      case "/":
        return this.askSearch();
      case "r":
        return this.askRelated();
    }
    if (this.view !== "list") return true;

    switch (key.name) {
      case "h":
        this.showDone = !this.showDone;
        this.reload();
        this.say(this.showDone ? "showing closed tasks" : "hiding closed tasks");
        return true;
      case "n":
        this.prompt = {
          label: "new task:",
          hint: "one line — what needs to be true",
          value: "",
          onSubmit: (v) => this.newTask(v),
        };
        return true;
      case "s":
        return this.startCurrent();
      case "x":
        writeActive(this.board, null);
        this.reload();
        this.say("cleared active task");
        return true;
      case "e":
        return this.askLog();
      case "a":
        return this.askQuestion();
      case "D":
        return this.askDone();
      case "E":
        return this.editTask();
    }
    return true;
  }

  private detailKey(key: Key): boolean {
    switch (key.name) {
      case "j":
      case "down":
        this.detailScroll++;
        return true;
      case "k":
      case "up":
        this.detailScroll = Math.max(0, this.detailScroll - 1);
        return true;
      case "pagedown":
        this.detailScroll += 10;
        return true;
      case "pageup":
        this.detailScroll = Math.max(0, this.detailScroll - 10);
        return true;
      case "g":
        this.detailScroll = 0;
        return true;
      case "e":
        return this.askLog();
      case "a":
        return this.askQuestion();
      case "s":
        return this.startCurrent();
      case "D":
        return this.askDone();
      case "E":
        return this.editTask();
      case "/":
        return this.askSearch();
      case "r":
        return this.askRelated();
    }
    return true;
  }

  private open(): boolean {
    if (this.view === "search" || this.view === "related") {
      const task = this.view === "related" ? this.relatedRows[this.cursor] : this.hits[this.cursor]?.task;
      if (task) {
        this.detail = task;
        this.detailScroll = 0;
        this.view = "detail";
      }
      return true;
    }
    const row = this.current();
    if (!row) return true;
    this.detail = row.task;
    this.detailScroll = 0;
    this.view = "detail";
    return true;
  }

  /** In detail view the subject is the open task; in the list it is the cursor. */
  private subject(): Task | null {
    if (this.view === "detail") return this.detail;
    return this.current()?.task ?? null;
  }

  // ---------- actions ----------

  private newTask(title: string): void {
    const task = withLock(this.board, () => createTask(this.board, { title }));
    this.reload(task.id);
    this.say(`created ${task.id} — press E to add acceptance criteria`);
  }

  private startCurrent(): boolean {
    const t = this.subject();
    if (!t) return true;
    withLock(this.board, () => {
      t.status = "doing";
      writeTask(t);
      writeActive(this.board, t.id);
    });
    this.reload(t.id);
    this.say(
      t.doneWhen.length
        ? `active: ${t.id}`
        : `active: ${t.id} — no acceptance criteria, completion cannot be verified`,
      t.doneWhen.length ? "info" : "error",
    );
    return true;
  }

  /** Hand-editing is a first-class path, so the board hands over rather than
   * reimplementing a form for every field. */
  private editTask(): boolean {
    const t = this.subject();
    if (!t) return true;
    const editor = process.env.CAIRNS_EDITOR ?? process.env.VISUAL ?? process.env.EDITOR;
    if (!editor) {
      this.say("no $EDITOR set — cannot open the task file", "error");
      return true;
    }
    if (!this.host) return true;
    this.host.suspend(() => {
      spawnSync(editor, [t.path], { stdio: "inherit", shell: true });
    });
    this.reload(t.id);
    this.say(`reloaded ${t.id}`);
    return true;
  }

  private askLog(): boolean {
    const t = this.subject();
    if (!t) return true;
    this.prompt = {
      label: `log ${t.id}:`,
      hint: "decided: / dead end: / note: … because <mechanism>",
      value: "",
      onSubmit: (v) => this.writeLog(t, v),
    };
    return true;
  }

  private writeLog(task: Task, raw: string): void {
    const parsed = parseInput(raw);
    const check = validate(parsed.kind, parsed.text);
    if (!check.ok) {
      // Same refusal as the CLI: a verdict with no mechanism is not a record.
      this.say(`${check.reason} — add "because <why>", or state mechanism: unknown`, "error");
      return;
    }
    const entry = withLock(this.board, () =>
      appendLog(this.board, task.id, {
        author: detectAuthor(),
        kind: parsed.kind,
        text: parsed.text,
        supersedes: parsed.supersedes,
      }),
    );
    this.reload(task.id);
    this.say(`recorded ${kindLabel(entry.kind)} ${entry.id}`);
  }

  private askQuestion(): boolean {
    const t = this.subject();
    if (!t) return true;
    this.prompt = {
      label: `ask ${t.id}:`,
      hint: "surfaces in cairn context until answered",
      value: "",
      onSubmit: (v) => {
        const entry = withLock(this.board, () =>
          appendLog(this.board, t.id, { author: detectAuthor(), kind: "question", text: v }),
        );
        this.reload(t.id);
        this.say(`asked ${entry.id}`);
      },
    };
    return true;
  }

  private askDone(): boolean {
    const t = this.subject();
    if (!t) return true;
    if (t.status === "done") {
      this.say(`${t.id} is already closed`, "error");
      return true;
    }
    this.prompt = {
      label: `close ${t.id} — outcome:`,
      hint: "what shipped; what a future reader needs",
      value: "",
      onSubmit: (v) => this.closeTask(t, v),
    };
    return true;
  }

  private closeTask(task: Task, outcome: string): void {
    withLock(this.board, () => {
      task.status = "done";
      task.closed = today();
      task.body = writeSection(task.body, "outcome", outcome);
      writeTask(task);
      appendLog(this.board, task.id, { author: detectAuthor(), kind: "outcome", text: outcome });
      if (readActive(this.board) === task.id) writeActive(this.board, null);
    });
    this.reload(task.id);
    const deadEnds = readLog(this.board, task.id).filter((e) => e.kind === "dead-end").length;
    this.say(
      deadEnds
        ? `closed ${task.id} — ${deadEnds} dead end${deadEnds === 1 ? "" : "s"} retrievable via related`
        : `closed ${task.id} — no dead ends recorded`,
    );
  }

  private askSearch(): boolean {
    this.prompt = {
      label: "search:",
      hint: "ranked across logs and closed tasks",
      value: "",
      onSubmit: (v) => {
        this.query = v;
        this.hits = search(this.board, v, { limit: 50 });
        this.cursor = 0;
        this.view = "search";
      },
    };
    return true;
  }

  private askRelated(): boolean {
    this.prompt = {
      label: "related to path:",
      hint: "what to know before editing this file",
      value: "",
      onSubmit: (v) => {
        this.relatedResult = related(this.board, v);
        this.relatedRows = [];
        this.cursor = 0;
        this.view = "related";
      },
    };
    return true;
  }
}

function entryLines(e: LogEntry, width: number, superseded: boolean, openQuestion: boolean): string[] {
  const colour =
    e.kind === "dead-end"
      ? yellow
      : e.kind === "outcome"
        ? green
        : e.kind === "question"
          ? (s: string) => (openQuestion ? magenta(s) : dim(s))
          : (s: string) => s;
  const head = `    ${dim(shortDate(e.ts))} ${dim(e.author)} ${colour(kindLabel(e.kind))}: `;
  const out = wrapHanging(head, e.text, width, "      ");
  if (e.mechanism) out.push(dim(`      mechanism: ${e.mechanism}`));
  if (e.evidence) out.push(dim(`      evidence: ${e.evidence.split("\n")[0]}`));
  if (superseded) out.push(dim("      (superseded)"));
  out.push(dim(`      [${e.id}]`));
  return out;
}

/**
 * Wraps against the *visible* width of the first-line prefix, so a coloured
 * `date author kind:` head does not push the first line past the terminal edge
 * and leave the remainder looking like an orphaned fragment.
 */
function wrapHanging(prefix: string, text: string, width: number, indent: string): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  let budget = width - visLen(prefix);
  for (const word of words) {
    const candidate = cur ? `${cur} ${word}` : word;
    if (candidate.length > budget && cur) {
      lines.push(cur);
      cur = word;
      budget = width - indent.length;
    } else {
      cur = candidate;
    }
  }
  if (cur) lines.push(cur);
  return lines.map((l, i) => (i === 0 ? prefix + l : indent + l));
}

/** Active first, then work in progress, then open by recency, closed last. */
function rank(activeId: string | null) {
  const weight = (t: Task) => (t.id === activeId ? 0 : t.status === "doing" ? 1 : t.status === "open" ? 2 : 3);
  return (a: Task, b: Task) =>
    weight(a) - weight(b) || (b.updated ?? "").localeCompare(a.updated ?? "") || a.id.localeCompare(b.id);
}

function clampScroll(cursor: number, scroll: number, height: number): number {
  if (cursor < scroll) return cursor;
  if (cursor >= scroll + height) return cursor - height + 1;
  return scroll;
}

const highlight = (s: string, width: number) => `\u001b[7m${pad(s, width)}\u001b[27m`;

export async function board(_args: Args): Promise<number> {
  const b = requireBoard();
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error("cairn board needs an interactive terminal");
    console.error(dim("  try `cairn list` or `cairn context` when piping output"));
    return 1;
  }
  return run(new BoardApp(b));
}
