import { spawnSync } from "node:child_process";
import type { Args } from "../lib/args.js";
import { requireBoard } from "../lib/board.js";
import { dim, red } from "../lib/ui.js";
import { resolveOrExplain } from "./resolve.js";

/**
 * Hand-editing is a first-class path — the parser is built for it. This is only
 * a shortcut to the file.
 */
export function edit(args: Args): number {
  const board = requireBoard();
  const task = resolveOrExplain(board, args.positional[0]);
  if (!task) return 1;

  const editor = process.env.CAIRNS_EDITOR ?? process.env.VISUAL ?? process.env.EDITOR;
  if (!editor) {
    console.log(task.path);
    console.log(dim("set $EDITOR to open it directly"));
    return 0;
  }

  const r = spawnSync(editor, [task.path], { stdio: "inherit", shell: true });
  if (r.error) {
    console.error(`${red("could not launch")} ${editor}: ${r.error.message}`);
    console.log(task.path);
    return 1;
  }
  return r.status ?? 0;
}
