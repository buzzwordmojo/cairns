import { rmSync } from "node:fs";
import { relative } from "node:path";
import type { Args } from "../lib/args.js";
import { flagBool } from "../lib/args.js";
import { BOARD_DIR, requireBoard } from "../lib/board.js";
import { removeHooks, removeMergeDriver } from "../lib/githooks.js";
import { removeProtocol } from "../lib/protocol.js";
import { bold, cyan, dim, green, yellow } from "../lib/ui.js";
import { listTasks } from "../lib/task.js";

/**
 * Every artifact `cairn init` writes carries a marker so this can be a surgical
 * edit rather than a guess. A tool that installs git hooks has to be able to
 * take them back out, or the only safe answer is never to install it.
 */
export function uninstall(args: Args): number {
  const board = requireBoard();
  const purge = flagBool(args, "purge", false);

  for (const h of removeHooks(board)) {
    const label = {
      removed: green("removed "),
      restored: green("restored"),
      absent: dim("absent  "),
      // A hook without our marker belongs to someone else. Report it rather
      // than deleting it, so a stale hook is the worst case instead of a lost one.
      foreign: yellow("kept    "),
    }[h.result];
    const note = h.result === "foreign" ? dim("  (not ours — no cairns marker)") : "";
    console.log(`${label}  .git/hooks/${h.name}${note}`);
  }

  const attrs = removeMergeDriver(board);
  console.log(`${attrs ? green("removed ") : dim("absent  ")}  .gitattributes (log merge=union)`);

  const proto = removeProtocol(board);
  const protoRel = relative(board.root, proto.file) || proto.file;
  console.log(
    `${proto.removed ? green("removed ") : dim("absent  ")}  ${protoRel} (agent protocol block)`,
  );

  const tasks = listTasks(board).length;
  const count = `${tasks} task${tasks === 1 ? "" : "s"}`;
  if (purge) {
    rmSync(board.dir, { recursive: true, force: true });
    console.log(`${green("removed ")}  ${BOARD_DIR}/ ${dim(`(${count})`)}`);
  } else {
    // The board is the accumulated memory. Removing the plumbing should never
    // remove the record, so deleting it stays an explicit, separate decision.
    console.log(`${dim("kept    ")}  ${BOARD_DIR}/ ${dim(`(${count})`)}`);
    if (tasks) console.log(`\n${dim("the board is still readable as plain markdown.")}`);
    console.log(dim(`delete it with `) + cyan("cairn uninstall --purge") + dim(" or ") + cyan(`rm -rf ${BOARD_DIR}`));
  }

  if (!purge) console.log(`\n${dim("reinstall with")}  ${bold("cairn init")}`);
  return 0;
}
