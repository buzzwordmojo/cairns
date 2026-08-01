import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { Args } from "../lib/args.js";
import { flagBool } from "../lib/args.js";
import { BOARD_DIR, locate, notesPath } from "../lib/board.js";
import { installHooks, installMergeDriver } from "../lib/githooks.js";
import { installProtocol, targetFile } from "../lib/protocol.js";
import { bold, cyan, dim, green, yellow } from "../lib/ui.js";

const BOARD_GITIGNORE = `# derived state — never committed, or the board invents merge conflicts
.active
.index/
.cache/
`;

const NOTES_TEMPLATE = `# Project notes

Short, hand-written facts about this repo that an agent should see every
session. Capped at 15 — once at cap, adding means removing, which forces the
triage that otherwise never happens.

Each note says what is true, when it became true, and what would make you
recheck it.

<!-- cairns:notes:begin -->
## Notes
<!-- cairns:notes:end -->
`;

export function init(args: Args): number {
  const board = locate();
  const created = !existsSync(board.dir);
  mkdirSync(board.dir, { recursive: true });

  const gitignore = join(board.dir, ".gitignore");
  if (!existsSync(gitignore)) writeFileSync(gitignore, BOARD_GITIGNORE);

  if (!existsSync(notesPath(board))) writeFileSync(notesPath(board), NOTES_TEMPLATE);

  console.log(`${created ? green("created") : dim("exists ")}  ${BOARD_DIR}/`);

  const withHooks = flagBool(args, "hooks", true);
  if (withHooks) {
    for (const h of installHooks(board)) {
      const label = h.result === "skipped" ? yellow("skipped") : green(h.result.padEnd(7));
      console.log(`${label}  .git/hooks/${h.name}`);
    }
    const attrs = installMergeDriver(board);
    console.log(`${attrs === "unchanged" ? dim("exists ") : green(attrs.padEnd(7))}  .gitattributes (log merge=union)`);
  } else {
    console.log(`${yellow("skipped")}  git hooks (--no-hooks)`);
  }

  if (flagBool(args, "protocol", true)) {
    const file = targetFile(board);
    const status = installProtocol(board, file);
    const rel = relative(board.root, status.file) || status.file;
    const label = status.result === "unchanged" ? dim("exists ") : green(status.result.padEnd(7));
    console.log(`${label}  ${rel} (agent protocol block)`);
  }

  if (!board.gitDir) {
    console.log(
      `\n${yellow("!")} not a git repository. The board works, but ${bold("cairn related")} has nothing`,
    );
    console.log(`  to derive links from until this is version controlled.`);
  }

  console.log(`\n${dim("next")}  ${cyan('cairn add "the first thing on your mind"')}`);
  console.log(`      ${cyan("cairn context")}   ${dim("— what an agent should load at session start")}`);
  return 0;
}

/** Nudge shown by other commands when the board is missing. */
export function boardMissingHint(): string {
  return `no board here. Run ${bold("cairn init")} in your repo root.`;
}

export function readIfExists(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}
