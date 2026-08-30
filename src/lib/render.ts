import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Board, TASK_FILE, TASKS_DIR, readActive } from "./board.js";
import { type LogEntry, openQuestionEntries, readLog, supersededIds } from "./log.js";
import { readProjectNotes } from "./notes.js";
import { type Task, listTasks } from "./task.js";

export const RENDER_FILE = "README.md";

/** Editing the rendered file is a wasted edit; say so at the top of it. */
export const GENERATED_MARKER = "<!-- cairns:generated -->";

/**
 * Sections are capped so a five-year-old board still renders as a page someone
 * reads rather than scrolls past. Every cap announces itself on the page — a
 * silently truncated list reads as a complete one.
 */
export const DEAD_END_CAP = 40;
export const QUESTION_CAP = 20;

export const pagePath = (b: Board) => join(b.dir, RENDER_FILE);

/**
 * Written through a rename so a reader never sees half a page. Two worktrees can
 * refresh at the same moment — the board lock is deliberately not held here,
 * because this runs after a command has already released it and a second
 * acquisition would deadlock the day someone calls it from inside one.
 */
export function writePage(target: string, body: string): void {
  const tmp = `${target}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, body);
    renameSync(tmp, target);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {
      /* the temp file is already gone, or was never created */
    }
    throw err;
  }
}

/**
 * The page is derived from `.tasks/`, so what invalidates it is a cairn command,
 * not a git event. Wiring the only refresh to `post-merge` meant a repo that
 * never merges rendered once and then drifted in silence: a board page claiming
 * 34 open tasks against 51 on disk, three weeks behind, with `--check` never run
 * because nothing runs it outside CI.
 *
 * Best-effort by construction. A board mutation that already landed on disk must
 * never be reported as failed because a derived file could not be rewritten.
 */
export function refreshBoardPage(board: Board): "created" | "updated" | "unchanged" | "failed" {
  try {
    const target = pagePath(board);
    const body = renderBoard(board);
    const current = existsSync(target) ? readFileSync(target, "utf8") : null;
    if (current === body) return "unchanged";
    writePage(target, body);
    return current === null ? "created" : "updated";
  } catch {
    return "failed";
  }
}

interface Row {
  task: Task;
  deadEnds: LogEntry[];
  questions: LogEntry[];
  entries: number;
}

/**
 * Newest first. Ids are time-ordered and `listTasks` sorts them ascending, so
 * the untouched order buried today's work under every task ever opened — on a
 * 52-row board everything worth reading was below the fold.
 */
function collect(board: Board): Row[] {
  return listTasks(board).reverse().map((task) => {
    const entries = readLog(board, task.id);
    const superseded = supersededIds(entries);
    return {
      task,
      // A dead end that a later entry overturned is not a dead end any more,
      // and leaving it on the page is how a corrected record keeps misleading.
      deadEnds: entries.filter((e) => e.kind === "dead-end" && !superseded.has(e.id)),
      questions: openQuestionEntries(entries),
      entries: entries.length,
    };
  });
}

/** Table cells cannot hold a pipe or a newline and survive as one row. */
function cell(s: string): string {
  return s.replace(/\s+/g, " ").replace(/\|/g, "\\|").trim();
}

// Relative to `.tasks/`, where the page lives — so it carries the `tasks/` segment.
const link = (id: string) => `[\`${id}\`](${TASKS_DIR}/${id}/${TASK_FILE})`;

interface Column {
  head: string;
  align: string;
  value: (r: Row) => string;
  /** False when every cell would be blank, which is width the title could use. */
  used: (rows: Row[]) => boolean;
}

const count = (n: number) => (n ? String(n) : "");
const any = (pick: (r: Row) => number) => (rows: Row[]) => rows.some((r) => pick(r) > 0);

/**
 * Title sits last because it is the only wide cell — a full sentence, 74
 * characters at the median and 180 at the worst. Ahead of it the row is narrow
 * and fixed-width, so a column of tasks stays scannable down its left edge
 * instead of every signal being shoved past a paragraph.
 *
 * `Created` is the date the task file carries, never one computed from now.
 * Bucketing by age — "this week", "this month" — reads better and cannot ship:
 * it would make the page a function of the clock, so the same `.tasks/` would
 * render different bytes tomorrow, `--check` would report a correct page as
 * stale every midnight, and two branches would conflict over a header neither
 * one edited.
 */
const COLUMNS: Column[] = [
  { head: "Task", align: "---", value: (r) => link(r.task.id), used: () => true },
  { head: "Created", align: "---", value: (r) => r.task.created, used: (rows) => rows.some((r) => r.task.created) },
  { head: "Dead ends", align: "--:", value: (r) => count(r.deadEnds.length), used: any((r) => r.deadEnds.length) },
  { head: "Questions", align: "--:", value: (r) => count(r.questions.length), used: any((r) => r.questions.length) },
  { head: "Log", align: "--:", value: (r) => count(r.entries), used: any((r) => r.entries) },
  { head: "Title", align: "---", value: (r) => cell(r.task.title), used: () => true },
];

function table(rows: Row[]): string[] {
  // Per-table, not per-board: a one-row In progress section should not carry
  // three empty numeric columns just because some open task elsewhere uses them.
  const cols = COLUMNS.filter((c) => c.used(rows));
  const out = [
    `| ${cols.map((c) => c.head).join(" | ")} |`,
    `| ${cols.map((c) => c.align).join(" | ")} |`,
  ];
  for (const r of rows) out.push(`| ${cols.map((c) => c.value(r)).join(" | ")} |`);
  return out;
}

function section(title: string, rows: Row[]): string[] {
  if (!rows.length) return [];
  return ["", `## ${title} (${rows.length})`, "", ...table(rows)];
}

function closedSection(rows: Row[]): string[] {
  if (!rows.length) return [];
  const out = ["", "<details>", `<summary><b>Closed (${rows.length})</b></summary>`, ""];
  for (const r of rows) {
    out.push(`### ${link(r.task.id)} — ${cell(r.task.title)}`, "");
    out.push(`closed ${r.task.closed ?? r.task.updated}`, "");
    // The outcome is the whole reason a closed task stays on the board.
    if (r.task.outcome) out.push(r.task.outcome.trim(), "");
  }
  out.push("</details>");
  return out;
}

function finding(e: LogEntry, byId: Map<string, Task>): string[] {
  const task = byId.get(e.task);
  const where = task ? `${link(e.task)} ${cell(task.title)}` : `\`${e.task}\``;
  const out = [`- **${e.ts.slice(0, 10)}** · ${where}`, `  ${cell(e.text)}`];
  if (e.mechanism) out.push(`  mechanism: ${cell(e.mechanism)}`);
  return out;
}

function deadEndSection(rows: Row[], byId: Map<string, Task>): string[] {
  const all = rows
    .flatMap((r) => r.deadEnds)
    .sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
  if (!all.length) return [];

  const shown = all.slice(0, DEAD_END_CAP);
  const out = ["", "<details>", `<summary><b>Dead ends (${all.length})</b></summary>`, ""];
  out.push("Approaches that were tried and failed, with the mechanism that killed them.", "");
  for (const e of shown) out.push(...finding(e, byId), "");
  if (all.length > shown.length) {
    out.push(
      `_${all.length - shown.length} older dead ends are not shown — \`cairn search <term>\` reaches all of them._`,
      "",
    );
  }
  out.push("</details>");
  return out;
}

function questionSection(rows: Row[], byId: Map<string, Task>): string[] {
  const all = rows.flatMap((r) => r.questions);
  if (!all.length) return [];
  const shown = all.slice(0, QUESTION_CAP);
  const out = ["", `## Open questions (${all.length})`, ""];
  out.push("Waiting on a human. Answer with `cairn answer <log-id> \"<decision>\"`.", "");
  for (const e of shown) out.push(...finding(e, byId), "");
  if (all.length > shown.length) {
    out.push(`_${all.length - shown.length} more — \`cairn context\` lists every open question._`);
  }
  return out;
}

function noteSection(board: Board): string[] {
  // Rendered without the staleness check on purpose. `markStale` asks git
  // whether a named path moved, which makes the answer depend on how deep the
  // clone is — and a page whose bytes differ between a full clone and a shallow
  // CI checkout cannot be verified with `--check`.
  const notes = readProjectNotes(board);
  if (!notes.length) return [];
  const out = ["", `## Project notes (${notes.length})`, ""];
  out.push("Hand-written and unverified. Weigh them against the code.", "");
  for (const n of notes) {
    const meta = [n.since ? `since ${n.since}` : "", n.recheckIf ? `recheck if: ${n.recheckIf}` : ""]
      .filter(Boolean)
      .join(" · ");
    out.push(`- ${cell(n.text)}${meta ? `\n  ${meta}` : ""}`);
  }
  return out;
}

/**
 * Deterministic by construction: no timestamp, no clock, nothing derived from
 * git. The same `.tasks/` renders byte-identical everywhere, which is what lets
 * `--check` mean "stale" instead of "generated on a different machine", and what
 * keeps two branches from conflicting over a header line neither one edited.
 */
export function renderBoard(board: Board): string {
  const rows = collect(board);
  const byId = new Map(rows.map((r) => [r.task.id, r.task]));
  const active = readActive(board);

  const out: string[] = ["# Task board", "", GENERATED_MARKER, ""];
  out.push(
    "Generated by `cairn render` from the files beside it. Edits here are overwritten —",
    "the source of truth is each task's `task.md` and append-only `log.ndjson`.",
  );

  if (!rows.length) {
    out.push("", "No tasks yet. `cairn add \"<thought>\"` starts one.", "");
    return `${out.join("\n").replace(/\s+$/, "")}\n`;
  }

  const activeRow = active ? rows.find((r) => r.task.id === active) : undefined;
  if (activeRow) {
    out.push("", `**Active:** ${link(activeRow.task.id)} — ${cell(activeRow.task.title)}`);
  }

  out.push(...section("In progress", rows.filter((r) => r.task.status === "doing")));
  out.push(...section("Open", rows.filter((r) => r.task.status === "open")));
  out.push(...questionSection(rows, byId));
  out.push(...deadEndSection(rows, byId));
  out.push(...closedSection(rows.filter((r) => r.task.status === "done")));
  out.push(...noteSection(board));

  out.push(
    "",
    "---",
    "",
    "Regenerate with `cairn render`. `cairn render --check` fails when this file is stale.",
  );

  return `${out.join("\n").replace(/\s+$/, "")}\n`;
}
