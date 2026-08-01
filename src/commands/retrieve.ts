import type { Args } from "../lib/args.js";
import { flagBool, flagNumber } from "../lib/args.js";
import { requireBoard } from "../lib/board.js";
import { buildIndex, saveIndex } from "../lib/index-cache.js";
import { openQuestionEntries, readLog, renderEntry, supersededIds } from "../lib/log.js";
import { related } from "../lib/related.js";
import { search as runSearch } from "../lib/search.js";
import { listTasks } from "../lib/task.js";
import { bold, cyan, dim, green, heading, truncate, yellow } from "../lib/ui.js";
import { resolveOrExplain } from "./resolve.js";

export function search(args: Args): number {
  const board = requireBoard();
  const query = args.positional.join(" ").trim();
  if (!query) {
    console.error(`usage: cairn search <term>`);
    return 2;
  }

  const limit = flagNumber(args, "limit", 10);
  // Ranked and truncated. A search that dumps forty log lines has auto-loaded
  // the log through the back door.
  const all = runSearch(board, query, { limit: Number.MAX_SAFE_INTEGER });
  const hits = all.slice(0, limit);

  if (hits.length === 0) {
    console.log(dim(`no match for "${query}" in ${listTasks(board).length} tasks.`));
    console.log(dim(`this is a real absence, not an error — nothing has been recorded on it.`));
    return 0;
  }

  for (const h of hits) {
    const status = h.task.status === "done" ? green("closed") : yellow(h.task.status);
    console.log(`${h.line}  ${dim(`(${status} ${dim(h.task.title)})`)}`);
  }
  if (all.length > hits.length) {
    console.log(dim(`\n${all.length - hits.length} more — \`cairn search "${query}" --limit ${all.length}\``));
  }
  return 0;
}

/** The most valuable output in the product: what to know before editing a file. */
export function relatedCmd(args: Args): number {
  const board = requireBoard();
  const path = args.positional[0];
  if (!path) {
    console.error(`usage: cairn related <path>`);
    return 2;
  }

  const r = related(board, path, { rebuild: flagBool(args, "rebuild", false) });
  console.log(`${bold(r.path)}\n`);

  for (const row of [...r.closed]) {
    const when = row.task.closed ?? row.task.updated;
    console.log(`${bold(row.task.id)} ${dim(`closed ${when}`)}  ${row.task.title}${methodTag(row.method)}`);
    for (const f of row.findings) {
      const icon = f.kind === "dead-end" ? yellow("⚠ dead end") : dim(f.kind);
      console.log(`  ${icon}: ${truncate(f.text, 78)}`);
      if (f.mechanism) console.log(dim(`    mechanism: ${truncate(f.mechanism, 70)}`));
      console.log(dim(`    ${f.id}, ${f.ts.slice(0, 10)}`));
    }
    if (row.findings.length === 0) console.log(dim(`  (no findings recorded)`));
    console.log("");
  }

  if (r.open.length) {
    const one = r.open.length === 1;
    console.log(`${r.open.length} open task${one ? "" : "s"} ${one ? "touches" : "touch"} this path: ${r.open.map((o) => o.task.id).join(", ")}`);
  }

  if (r.empty) {
    console.log(dim(`no tasks recorded against this path.`));
    // Absence of evidence must be reported as absence of evidence — an empty
    // result reads to an agent as "no prior art here", which is worse than
    // never having asked.
    if (!r.hooksInstalled) {
      console.log(
        yellow(`\n⚠ no cairns commit hooks in this clone, so attribution is unavailable here.`),
      );
      console.log(yellow(`  this result means "unknown", not "nothing". Fix: `) + cyan("cairn init --hooks"));
    } else if (r.trailerCommitsInRepo === 0) {
      console.log(
        yellow(`\n⚠ no commit carries a Task: trailer yet — every result will be empty until`),
      );
      console.log(yellow(`  a commit lands while a task is active (\`cairn start <id>\`).`));
    }
  }
  return 0;
}

export function show(args: Args): number {
  const board = requireBoard();
  const task = resolveOrExplain(board, args.positional[0]);
  if (!task) return 1;

  console.log(`${bold(task.id)}  ${task.title}  ${dim(`[${task.status}]`)}`);
  if (task.targets.length) console.log(dim(`targets: ${task.targets.join(", ")}`));
  console.log("");

  if (task.doneWhen.length) {
    console.log(heading("done when"));
    for (const l of task.doneWhen) console.log(`- ${l}`);
    console.log("");
  }
  if (task.context) console.log(`${heading("context")}\n${task.context}\n`);
  if (task.notes.length) {
    console.log(heading("notes"));
    for (const n of task.notes) console.log(`- ${n}`);
    console.log("");
  }
  if (task.outcome) console.log(`${heading("outcome")}\n${task.outcome}\n`);

  const entries = readLog(board, task.id);
  const superseded = supersededIds(entries);
  const open = new Set(openQuestionEntries(entries).map((e) => e.id));
  if (entries.length) {
    console.log(heading(`log (${entries.length})`));
    for (const e of entries) {
      const line = renderEntry(e);
      if (superseded.has(e.id) && !open.has(e.id)) console.log(dim(`${line}  (superseded)`));
      else console.log(line);
    }
  } else {
    console.log(dim("log is empty"));
  }
  return 0;
}

export function logOnly(args: Args): number {
  const board = requireBoard();
  const task = resolveOrExplain(board, args.positional[0]);
  if (!task) return 1;
  const entries = readLog(board, task.id);
  if (!entries.length) {
    console.log(dim(`no log entries on ${task.id}`));
    return 0;
  }
  for (const e of entries) console.log(renderEntry(e));
  return 0;
}

export function list(args: Args): number {
  const board = requireBoard();
  const all = listTasks(board);
  const showDone = flagBool(args, "all", false) || flagBool(args, "done", false);
  const tasks = showDone ? all : all.filter((t) => t.status !== "done");

  if (!tasks.length) {
    console.log(dim(all.length ? "no open tasks" : "no tasks yet — `cairn add \"<thought>\"`"));
    return 0;
  }

  for (const t of tasks) {
    const mark = t.status === "done" ? green("✓") : t.status === "doing" ? yellow("▶") : dim("·");
    const counts = readLog(board, t.id);
    const deadEnds = counts.filter((e) => e.kind === "dead-end").length;
    const tail = deadEnds ? dim(`  ${deadEnds} dead end${deadEnds === 1 ? "" : "s"}`) : "";
    console.log(`${mark} ${bold(t.id)}  ${truncate(t.title, 56).padEnd(56)}${tail}`);
  }
  if (!showDone && all.length > tasks.length) {
    console.log(dim(`\n${all.length - tasks.length} closed — \`cairn list --all\``));
  }
  return 0;
}

export function reindex(_args: Args): number {
  const board = requireBoard();
  if (!board.gitDir) {
    console.error("not a git repository — nothing to index");
    return 1;
  }
  const idx = buildIndex(board);
  saveIndex(board, idx);
  const paths = Object.keys(idx.paths).length;
  const tasks = Object.keys(idx.tasks).length;
  console.log(dim(`indexed ${paths} paths across ${tasks} tasks`));
  return 0;
}

function methodTag(method: string): string {
  // Label which method produced each result rather than presenting a derived
  // guess as a record.
  return method === "trailer" ? "" : dim(`  (via declared targets, not commits)`);
}
