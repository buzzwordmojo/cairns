#!/usr/bin/env node
import { existsSync } from "node:fs";
import { parseArgs } from "./lib/args.js";
import { BoardError, hasLegacyLayout, locate } from "./lib/board.js";
import { refreshBoardPage } from "./lib/render.js";
import { bold, cyan, dim } from "./lib/ui.js";
import { add } from "./commands/add.js";
import { context } from "./commands/context.js";
import { edit } from "./commands/edit.js";
import { init } from "./commands/init.js";
import { link } from "./commands/link.js";
import { migrate } from "./commands/migrate.js";
import { answer, ask, log } from "./commands/log.js";
import { render } from "./commands/render.js";
import { list, logOnly, reindex, relatedCmd, search, show } from "./commands/retrieve.js";
import { done, start, stop } from "./commands/status.js";
import { uninstall } from "./commands/uninstall.js";

export const VERSION = "0.0.3";

type Handler = (args: ReturnType<typeof parseArgs>) => number | Promise<number>;

export const COMMANDS: Record<string, Handler> = {
  init,
  uninstall,
  migrate,
  add,
  context,
  ctx: context,
  start,
  stop,
  done,
  log,
  ask,
  answer,
  search,
  related: relatedCmd,
  show,
  history: logOnly,
  list,
  ls: list,
  edit,
  link,
  reindex,
  render,
  board: boardTui,
};

/**
 * Commands that change `.tasks/` and therefore invalidate the rendered page.
 * It sits next to COMMANDS because the two lists have to move together — a new
 * mutating command that is not listed here reintroduces the exact silent drift
 * this list exists to stop. `test/render.test.ts` walks a real session through
 * every entry and fails if any of them leaves the page stale.
 *
 * `uninstall` is deliberately absent: it deletes the page, and re-rendering
 * afterwards would put back the one file it was asked to remove.
 */
export const MUTATES = new Set([
  "init",
  "migrate",
  "add",
  "start",
  "stop",
  "done",
  "log",
  "ask",
  "answer",
  "edit",
  "link",
]);

/**
 * Runs after the command, never inside it. The page is derived state — it cannot
 * be allowed to fail a mutation that already succeeded, so every failure path
 * here is a silent no-op and `cairn render --check` stays the thing that reports
 * staleness out loud.
 */
function refreshPage(): void {
  try {
    const board = locate();
    // A legacy board has nothing under `.tasks/tasks/`, so rendering it would
    // write a page saying the board is empty. `cairn migrate` renders instead.
    if (!existsSync(board.dir) || hasLegacyLayout(board)) return;
    refreshBoardPage(board);
  } catch {
    /* no board, no permission, no page — none of it is this command's problem */
  }
}

const HELP = `${bold("cairn")} — a repo-native task board that doubles as memory for coding agents

${bold("setup")}
  cairn init                     create .tasks/, install hooks, write the agent protocol
  cairn uninstall [--purge]      remove everything init wrote; keeps .tasks/ unless --purge
  cairn migrate [--dry-run]      one-time: move tasks into .tasks/tasks/ so the page renders first

${bold("capture")}
  cairn add "<thought>"          two-second capture into the backlog
  cairn edit [<id>]              open the task file
  cairn list [--all]             one line per task

${bold("session")}
  cairn context                  the fixed default load — run this first
  cairn start <id>               set the active task; commits get a Task: trailer
  cairn done <id> --outcome "…"  close with what a future reader needs
  cairn stop                     clear the active task

${bold("record")}
  cairn log [<id>] "decided: <what> because <why>"
  cairn log [<id>] "dead end: <what failed> because <mechanism>"
  cairn log [<id>] "note: <fact>"      [--mechanism unknown --evidence "…"]
  cairn ask [<id>] "<question>"        surfaces in context until answered
  cairn answer <log-id> "<decision>"

${bold("retrieve")}
  cairn search <term>            ranked across logs and closed tasks
  cairn related <path>           what to know before editing this file
  cairn link <id> <rev>…         recover the file list from commits that missed the trailer
  cairn show <id>                full task including log
  cairn history <id>             log only
  cairn board                    interactive board
  cairn render [--check]         write .tasks/README.md, which renders on a git host

${dim("docs: https://github.com/buzzwordmojo/cairns")}`;

async function boardTui(args: ReturnType<typeof parseArgs>): Promise<number> {
  const { board } = await import("./tui/board.js");
  return board(args);
}

export async function main(argv: string[]): Promise<number> {
  const [name, ...rest] = argv;

  if (!name || name === "help" || name === "--help" || name === "-h") {
    console.log(HELP);
    return 0;
  }
  if (name === "--version" || name === "-v" || name === "version") {
    console.log(VERSION);
    return 0;
  }

  const handler = COMMANDS[name];
  if (!handler) {
    console.error(`unknown command: ${name}`);
    const near = Object.keys(COMMANDS).filter((c) => c.startsWith(name[0] ?? ""));
    if (near.length) console.error(dim(`did you mean: ${near.join(", ")}`));
    console.error(dim(`\n${cyan("cairn help")} lists everything`));
    return 2;
  }

  try {
    const code = await handler(parseArgs(rest));
    // Only on success: a command that refused to act did not change the board,
    // and rendering on its way out would hide that nothing happened.
    if (code === 0 && MUTATES.has(name)) refreshPage();
    return code;
  } catch (err) {
    if (err instanceof BoardError) {
      console.error(err.message);
      return 1;
    }
    throw err;
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && /(?:^|[\\/])(cairn|cli)(?:\.[cm]?[jt]s)?$/.test(process.argv[1]);

if (invokedDirectly) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    });
}
