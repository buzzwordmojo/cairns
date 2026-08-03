import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { Args } from "../lib/args.js";
import { flagBool, flagString } from "../lib/args.js";
import { requireBoard } from "../lib/board.js";
import { RENDER_FILE, renderBoard } from "../lib/render.js";
import { cyan, dim, green, yellow } from "../lib/ui.js";

/**
 * Writes the one derived file that is meant to be committed. Everything else
 * cairns derives is gitignored; this one has to be in the tree or a git host has
 * nothing to render. `.gitattributes` keeps it from ever needing a hand merge.
 */
export function render(args: Args): number {
  const board = requireBoard();
  const out = flagString(args, "out", "o");
  const target = out ? resolve(board.root, out) : join(board.dir, RENDER_FILE);
  const rel = relative(board.root, target) || target;
  const body = renderBoard(board);

  if (flagBool(args, "stdout", false)) {
    process.stdout.write(body);
    return 0;
  }

  const current = existsSync(target) ? readFileSync(target, "utf8") : null;

  if (flagBool(args, "check", false)) {
    if (current === body) {
      console.log(dim(`${rel} is up to date`));
      return 0;
    }
    console.error(
      yellow(current === null ? `${rel} does not exist` : `${rel} is stale`) +
        dim(` — the board has changed since it was rendered`),
    );
    console.error(dim("regenerate: ") + cyan("cairn render"));
    return 1;
  }

  if (current === body) {
    console.log(dim(`unchanged  ${rel}`));
    return 0;
  }
  writeFileSync(target, body);
  console.log(`${current === null ? green("created") : green("updated")}  ${rel}`);
  return 0;
}
