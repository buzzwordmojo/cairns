import { existsSync, mkdirSync, renameSync } from "node:fs";
import { join, relative } from "node:path";
import type { Args } from "../lib/args.js";
import { flagBool } from "../lib/args.js";
import { BOARD_DIR, TASKS_DIR, legacyTaskIds, requireBoard, tasksRoot } from "../lib/board.js";
import { git } from "../lib/git.js";
import { RENDER_FILE, renderBoard } from "../lib/render.js";
import { cyan, dim, green, red } from "../lib/ui.js";
import { writeFileSync } from "node:fs";

/**
 * Moves tasks from the flat layout into `.tasks/tasks/`. One-time and idempotent:
 * the work is defined by what is still sitting at the top level, so a second run
 * finds nothing and says so.
 *
 * `git mv` rather than a bare rename wherever a repo is present — git detects the
 * rename either way, but staging it keeps the migration reviewable as renames
 * instead of surfacing as forty deletions and forty additions.
 */
export function migrate(args: Args): number {
  const board = requireBoard(process.cwd(), { allowLegacy: true });
  const ids = legacyTaskIds(board);
  const dryRun = flagBool(args, "dry-run", false);

  if (!ids.length) {
    console.log(`${dim("■")} nothing to migrate — tasks already live in ${BOARD_DIR}/${TASKS_DIR}/`);
    return 0;
  }

  const dest = tasksRoot(board);
  const collisions = ids.filter((id) => existsSync(join(dest, id)));
  if (collisions.length) {
    console.error(`${red("refused")} — ${collisions.length} task(s) exist in both layouts:`);
    for (const id of collisions.slice(0, 5)) console.error(dim(`  ${id}`));
    console.error(dim(`\nresolve by hand; moving over a live task would lose its log.`));
    return 1;
  }

  if (dryRun) {
    console.log(`${dim("■")} would move ${ids.length} task(s) into ${BOARD_DIR}/${TASKS_DIR}/`);
    for (const id of ids) console.log(dim(`  ${id}`));
    return 0;
  }

  mkdirSync(dest, { recursive: true });
  const useGit = board.gitDir !== null;
  let moved = 0;
  for (const id of ids) {
    const from = join(board.dir, id);
    const to = join(dest, id);
    const staged =
      useGit &&
      git(["mv", relative(board.root, from), relative(board.root, to)], board.root, { write: true })
        .ok;
    // An untracked task directory is a normal state — it just was not committed
    // yet — and `git mv` refuses those, so the plain rename is the fallback, not
    // the error path.
    if (!staged) renameSync(from, to);
    moved++;
  }

  const page = join(board.dir, RENDER_FILE);
  if (existsSync(page)) writeFileSync(page, renderBoard(board));

  console.log(`${green("moved")}    ${moved} task(s) → ${BOARD_DIR}/${TASKS_DIR}/`);
  if (existsSync(page)) console.log(`${green("rendered")} ${BOARD_DIR}/${RENDER_FILE}`);
  console.log(dim(`\ncommit the renames: `) + cyan(`git add -A ${BOARD_DIR} && git commit`));
  return 0;
}
