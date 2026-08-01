import type { Args } from "../lib/args.js";
import { requireBoard } from "../lib/board.js";
import { git } from "../lib/git.js";
import { withLock } from "../lib/lock.js";
import { writeTask } from "../lib/task.js";
import { bold, cyan, dim, green, red } from "../lib/ui.js";
import { resolveOrExplain } from "./resolve.js";

/**
 * Recovers the task-to-code link for commits made before the task existed, or
 * before it was active. A trailer cannot be added to a commit that is already
 * written without rewriting history, so the paths are recorded on the task and
 * reported under their own provenance — never folded into the trailer index or
 * into declared targets.
 */
export function link(args: Args): number {
  const board = requireBoard();
  if (!board.gitDir) {
    console.error(red("not a git repository — nothing to link"));
    return 1;
  }

  const task = resolveOrExplain(board, args.positional[0]);
  if (!task) return 1;

  const revs = args.positional.slice(1);
  if (!revs.length) {
    console.error(`${red("refused")} — no revision given`);
    console.error(dim(`\n  cairn link ${task.id} HEAD~2..HEAD`));
    console.error(dim(`  cairn link ${task.id} 0f7b065 bcb358f`));
    return 1;
  }

  const files = new Set<string>();
  for (const rev of revs) {
    const resolved = expand(board.root, rev);
    if (!resolved) {
      // Silently recording nothing is how a backfill looks successful and
      // leaves the link just as missing as before.
      console.error(`${red("refused")} — git cannot resolve "${rev}"`);
      return 1;
    }
    for (const sha of resolved) {
      for (const f of filesIn(board.root, sha)) {
        // The board's own files are not what the task changed about the code.
        if (!f.startsWith(".tasks/")) files.add(f);
      }
    }
  }

  const added = [...files].filter((f) => !task.linked.includes(f)).sort();
  if (!added.length) {
    console.log(dim(`nothing new — ${task.id} already links all ${files.size} of those paths`));
    return 0;
  }

  withLock(board, () => {
    task.linked = [...task.linked, ...added].sort();
    writeTask(task);
  });

  console.log(`${green("+")} ${bold(task.id)}  ${task.title}`);
  for (const f of added) console.log(dim(`  linked: ${f}`));
  console.log(
    dim(`\n${added.length} path${added.length === 1 ? "" : "s"} recorded. `) +
      dim(`${cyan("cairn related <path>")} reports these as backfilled, not as trailers.`),
  );
  return 0;
}

/** A range expands to its commits; anything else must name exactly one. */
function expand(root: string, rev: string): string[] | null {
  if (rev.includes("..")) {
    const r = git(["rev-list", "--no-merges", rev], root);
    if (!r.ok) return null;
    return r.stdout.split("\n").filter((l) => l.trim());
  }
  const r = git(["rev-parse", "--verify", "--quiet", `${rev}^{commit}`], root);
  const sha = r.stdout.trim();
  return r.ok && sha ? [sha] : null;
}

/** `--root` because without it the initial commit of a repo diffs against nothing. */
function filesIn(root: string, sha: string): string[] {
  const r = git(["diff-tree", "--no-commit-id", "--name-only", "-r", "-m", "--root", sha], root);
  if (!r.ok) return [];
  return r.stdout.split("\n").map((l) => l.trim()).filter(Boolean);
}
