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

interface Row {
  task: Task;
  deadEnds: LogEntry[];
  questions: LogEntry[];
  entries: number;
}

function collect(board: Board): Row[] {
  return listTasks(board).map((task) => {
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

function table(rows: Row[]): string[] {
  const out = [
    "| Task | Title | Dead ends | Questions | Log |",
    "| --- | --- | --: | --: | --: |",
  ];
  for (const r of rows) {
    const n = (v: number) => (v ? String(v) : "");
    out.push(
      `| ${link(r.task.id)} | ${cell(r.task.title)} | ${n(r.deadEnds.length)} | ${n(r.questions.length)} | ${n(r.entries)} |`,
    );
  }
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
