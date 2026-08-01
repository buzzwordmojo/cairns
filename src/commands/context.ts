import type { Args } from "../lib/args.js";
import { flagNumber } from "../lib/args.js";
import { type Board, readActive, requireBoard } from "../lib/board.js";
import { type Block, DEFAULT_BUDGET_TOKENS, fit } from "../lib/budget.js";
import { hooksInstalled } from "../lib/githooks.js";
import { getIndex } from "../lib/index-cache.js";
import { openQuestionEntries, readLog, supersededIds } from "../lib/log.js";
import { markStale, readProjectNotes } from "../lib/notes.js";
import { protocolDrift, protocolInstalled } from "../lib/protocol.js";
import { type Task, listTasks, readTask } from "../lib/task.js";
import { bold, cyan, dim, heading, truncate, yellow } from "../lib/ui.js";

/**
 * The fixed default load. Exits zero even when it truncates: the failure mode of
 * a session-start command that errors is an agent with no context at all.
 */
export function context(args: Args): number {
  const board = requireBoard();
  const budget = flagNumber(args, "budget", DEFAULT_BUDGET_TOKENS);
  const blocks: Block[] = [];

  const warnings = collectWarnings(board);
  if (warnings.length) blocks.push({ name: "warnings", priority: 99, lines: [...warnings, ""] });

  const notes = markStale(board, readProjectNotes(board));
  if (notes.length) {
    const lines = [heading("notes (project)"), dim("  hand-written, unverified — weigh against the code")];
    for (const n of notes) {
      lines.push(`- ${n.text}${n.since ? dim(` since ${n.since}`) : ""}`);
      if (n.stale) lines.push(yellow(`  ⚠ recheck-if: ${n.recheckIf} — that has moved since`));
      else if (n.recheckIf) lines.push(dim(`  recheck-if: ${n.recheckIf}`));
    }
    lines.push("");
    blocks.push({ name: "notes", priority: 90, lines });
  }

  const tasks = listTasks(board);
  const activeId = readActive(board);
  const active = activeId ? readTask(board, activeId) : null;

  if (active) blocks.push({ name: "active", priority: 100, lines: [...activeBlock(board, active), ""] });
  else blocks.push({ name: "active", priority: 100, lines: [dim("no active task — `cairn start <id>` sets one"), ""] });

  const questions = openQuestions(board, tasks, active?.id);
  if (questions.length) {
    blocks.push({
      name: "questions",
      priority: 80,
      lines: [heading(`open questions (${questions.length})`), ...questions, ""],
    });
  }

  const open = tasks
    .filter((t) => t.status !== "done" && t.id !== active?.id)
    .sort((a, b) => (b.updated ?? "").localeCompare(a.updated ?? ""));
  if (open.length) {
    // One line per task, so the agent knows the shape of the work without
    // paying to read it.
    const index = open.map((t) => `${t.id} ${truncate(t.title, 42)}`).join(" · ");
    blocks.push({ name: "backlog", priority: 40, lines: [`${heading(`open (${open.length})`)}  ${index}`, ""] });
  }

  blocks.push({ name: "nudge", priority: 95, lines: nudge(board, tasks, active) });

  const result = fit(blocks, budget);
  console.log(result.lines.join("\n").replace(/\n{3,}/g, "\n\n"));

  if (result.dropped.length) {
    const detail = result.dropped.map((d) => `${d.name} (-${d.lines} lines)`).join(", ");
    console.log(dim(`\n[truncated to ~${budget} tokens: ${detail}]`));
  }
  return 0;
}

function activeBlock(board: Board, t: Task): string[] {
  const lines = [`${heading("active")}  ${bold(t.id)}  ${t.title}`];
  if (t.doneWhen.length) lines.push(`  done when: ${t.doneWhen.join("; ")}`);
  else lines.push(yellow(`  done when: (none set — completion cannot be verified)`));
  for (const n of t.notes) lines.push(`  note: ${n}`);
  for (const q of t.questions) lines.push(`  open question: ${q}`);
  if (t.targets.length) lines.push(dim(`  targets: ${t.targets.join(", ")}`));

  const entries = readLog(board, t.id);
  const superseded = supersededIds(entries);
  const deadEnds = entries.filter((e) => e.kind === "dead-end" && !superseded.has(e.id)).slice(-2);
  for (const e of deadEnds) {
    lines.push(yellow(`  dead end: ${truncate(e.text, 90)}`) + dim(`  ${e.ts.slice(0, 10)} ${e.id}`));
  }
  return lines;
}

function openQuestions(board: Board, tasks: Task[], activeId?: string): string[] {
  const out: string[] = [];
  for (const t of tasks) {
    if (t.status === "done" || t.id === activeId) continue;
    for (const e of openQuestionEntries(readLog(board, t.id))) {
      out.push(`- ${t.id}: ${truncate(e.text, 80)}`);
    }
  }
  return out.slice(0, 5);
}

function nudge(board: Board, tasks: Task[], active: Task | null): string[] {
  // A retrieval layer the agent never thinks to call is dead weight, so the
  // default context has to advertise what is retrievable and when to reach for it.
  const closed = tasks.filter((t) => t.status === "done");
  const idx = getIndex(board);
  const targets = active?.targets ?? [];
  const touching = targets.length
    ? closed.filter((t) => (idx.tasks[t.id] ?? []).some((f) => targets.includes(f))).length
    : closed.length;

  const n = touching || closed.length;
  const subject = targets.length ? (n === 1 ? "touches these files" : "touch these files") : n === 1 ? "is recorded here" : "are recorded here";
  const head =
    closed.length === 0
      ? dim("No closed tasks yet — nothing to retrieve.")
      : `${bold(String(n))} closed task${n === 1 ? "" : "s"} ${subject}.`;
  return [
    `${head} Run ${cyan("cairn search <term>")} before proposing`,
    `an approach, and ${cyan("cairn related <path>")} before editing a file.`,
  ];
}

function collectWarnings(board: Board): string[] {
  const out: string[] = [];
  if (board.gitDir && !hooksInstalled(board)) {
    // Absence of evidence reported as absence of evidence: without trailers,
    // `related` returns nothing, and nothing reads as "no prior art here".
    out.push(
      yellow(`⚠ git hooks are not installed in this clone — commit trailers are not being written,`),
    );
    out.push(yellow(`  so \`cairn related\` will under-report. Fix: `) + cyan("cairn init --hooks"));
  }
  if (!protocolInstalled(board)) {
    out.push(yellow(`⚠ no agent protocol block found. Fix: `) + cyan("cairn init"));
  }
  const drift = protocolDrift(board);
  if (drift) {
    out.push(yellow(`⚠ protocol block is v${drift.version}, this binary writes a newer one. Fix: `) + cyan("cairn init"));
  }
  return out;
}
