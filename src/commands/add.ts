import type { Args } from "../lib/args.js";
import { flagList, flagString } from "../lib/args.js";
import { requireBoard } from "../lib/board.js";
import { withLock } from "../lib/lock.js";
import { createTask } from "../lib/task.js";
import { bold, cyan, dim, green } from "../lib/ui.js";

/**
 * Two-second capture. Capture matters more than tracking — a board that demands
 * ceremony at the moment of the thought does not get used.
 */
export function add(args: Args): number {
  const board = requireBoard();
  const title = args.positional.join(" ").trim();
  if (!title) {
    console.error(`usage: cairn add "<thought>"  [--done-when "a; b"] [--targets a.ts,b.ts]`);
    return 2;
  }

  const doneWhen = (flagString(args, "done-when", "d") ?? "")
    .split(/\s*;\s*/)
    .map((s) => s.trim())
    .filter(Boolean);

  const task = withLock(board, () =>
    createTask(board, {
      title,
      targets: flagList(args, "targets", "t"),
      doneWhen,
      context: flagString(args, "context") ?? "",
    }),
  );

  console.log(`${green("+")} ${bold(task.id)}  ${task.title}`);
  if (doneWhen.length === 0) {
    console.log(
      dim(`  no acceptance criteria yet — an agent without them guesses at completion`),
    );
    console.log(dim(`  add them: `) + cyan(`cairn edit ${task.id}`));
  }
  return 0;
}
