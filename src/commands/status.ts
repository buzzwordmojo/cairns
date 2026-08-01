import type { Args } from "../lib/args.js";
import { flagBool, flagString } from "../lib/args.js";
import { readActive, requireBoard, writeActive } from "../lib/board.js";
import { git } from "../lib/git.js";
import { hooksInstalled } from "../lib/githooks.js";
import { appendLog, detectAuthor, readLog } from "../lib/log.js";
import { withLock } from "../lib/lock.js";
import { readSection, writeSection } from "../lib/sections.js";
import { today, writeTask } from "../lib/task.js";
import { bold, cyan, dim, green, red, yellow } from "../lib/ui.js";
import { resolveOrExplain } from "./resolve.js";

export function start(args: Args): number {
  const board = requireBoard();
  const task = resolveOrExplain(board, args.positional[0]);
  if (!task) return 1;

  const previous = readActive(board);
  withLock(board, () => {
    task.status = "doing";
    writeTask(task);
    writeActive(board, task.id);
  });

  if (previous && previous !== task.id) {
    console.log(dim(`  was: ${previous}`));
  }
  console.log(`${green("▶")} ${bold(task.id)}  ${task.title}`);

  if (task.doneWhen.length) {
    for (const line of task.doneWhen) console.log(dim(`  done when: ${line}`));
  } else {
    console.log(yellow(`  no acceptance criteria — completion cannot be verified`));
  }

  if (board.gitDir && !hooksInstalled(board)) {
    console.log(
      yellow(`\n⚠ hooks missing in this clone: commits will not carry a Task: trailer,`),
    );
    console.log(yellow(`  so this task will not link to the files it changes. Fix: `) + cyan("cairn init --hooks"));
  }
  return 0;
}

export function stop(_args: Args): number {
  const board = requireBoard();
  const active = readActive(board);
  if (!active) {
    console.log(dim("no active task"));
    return 0;
  }
  writeActive(board, null);
  console.log(`${dim("■")} cleared active task ${active}`);
  return 0;
}

export function done(args: Args): number {
  const board = requireBoard();
  const task = resolveOrExplain(board, args.positional[0]);
  if (!task) return 1;

  const outcome = flagString(args, "outcome", "o") ?? args.positional.slice(1).join(" ").trim();
  if (!outcome) {
    console.error(`${red("refused")} — closing without an outcome loses the only durable part`);
    console.error(dim(`\n  cairn done ${task.id} --outcome "<what shipped; what a future reader needs>"`));
    if (task.doneWhen.length) {
      console.error(dim(`\n  done when:`));
      for (const l of task.doneWhen) console.error(dim(`    - ${l}`));
    }
    return 1;
  }

  const orphans = findOrphanMarkers(board.root, task.id);

  withLock(board, () => {
    task.status = "done";
    task.closed = today();
    task.body = writeSection(task.body, "outcome", outcome);

    // Compaction: a closed task's Context has stopped being loadable and become
    // a landfill, so it moves into the permanent log rather than being deleted.
    if (flagBool(args, "compact", true)) {
      const context = readSection(task.body, "context");
      if (context.length > 200) {
        appendLog(board, task.id, {
          author: "cairns",
          kind: "note",
          text: `archived context on close: ${context}`,
        });
        task.body = writeSection(task.body, "context", "(compacted on close — full text is in the log)");
      }
    }

    writeTask(task);
    appendLog(board, task.id, {
      author: flagString(args, "author") ?? detectAuthor(),
      kind: "outcome",
      text: outcome,
    });
    if (readActive(board) === task.id) writeActive(board, null);
  });

  console.log(`${green("✓")} ${bold(task.id)}  ${task.title}`);
  console.log(`  outcome: ${outcome}`);

  const entries = readLog(board, task.id);
  const deadEnds = entries.filter((e) => e.kind === "dead-end").length;
  if (deadEnds) {
    console.log(
      dim(`  ${deadEnds} dead end${deadEnds === 1 ? "" : "s"} recorded — retrievable via `) +
        cyan("cairn related <path>"),
    );
  } else {
    console.log(dim(`  no dead ends recorded on this task`));
  }

  if (task.doneWhen.length) {
    console.log(dim(`\n  verify each of these is actually true:`));
    for (const l of task.doneWhen) console.log(dim(`    - ${l}`));
  }

  if (orphans.length) {
    console.log(yellow(`\n⚠ ${orphans.length} source marker(s) still reference ${task.id}:`));
    for (const o of orphans.slice(0, 8)) console.log(yellow(`    ${o}`));
  }
  return 0;
}

/** Detection, not prevention — the same posture as everything else here. */
function findOrphanMarkers(root: string, id: string): string[] {
  const r = git(["grep", "-n", "-I", "--fixed-strings", `TODO(${id})`], root);
  if (!r.ok) return [];
  return r.stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}
