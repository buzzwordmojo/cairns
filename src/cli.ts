#!/usr/bin/env node
import { parseArgs } from "./lib/args.js";
import { BoardError } from "./lib/board.js";
import { bold, cyan, dim } from "./lib/ui.js";
import { add } from "./commands/add.js";
import { context } from "./commands/context.js";
import { edit } from "./commands/edit.js";
import { init } from "./commands/init.js";
import { answer, ask, log } from "./commands/log.js";
import { list, logOnly, reindex, relatedCmd, search, show } from "./commands/retrieve.js";
import { done, start, stop } from "./commands/status.js";
import { uninstall } from "./commands/uninstall.js";

export const VERSION = "0.1.0";

type Handler = (args: ReturnType<typeof parseArgs>) => number | Promise<number>;

const COMMANDS: Record<string, Handler> = {
  init,
  uninstall,
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
  reindex,
  board: boardTui,
};

const HELP = `${bold("cairn")} — a repo-native task board that doubles as memory for coding agents

${bold("setup")}
  cairn init                     create .tasks/, install hooks, write the agent protocol
  cairn uninstall [--purge]      remove everything init wrote; keeps .tasks/ unless --purge

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
  cairn show <id>                full task including log
  cairn history <id>             log only
  cairn board                    interactive board

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
    return await handler(parseArgs(rest));
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
