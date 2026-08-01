import type { Args } from "../lib/args.js";
import { flagString } from "../lib/args.js";
import { requireBoard } from "../lib/board.js";
import { normalizeTaskId } from "../lib/ids.js";
import { appendLog, detectAuthor, parseInput, readLog, renderEntry, validate } from "../lib/log.js";
import { withLock } from "../lib/lock.js";
import { listTasks } from "../lib/task.js";
import { dim, green, red, yellow } from "../lib/ui.js";
import { resolveOrExplain } from "./resolve.js";

/**
 * Append is the only semantic available on the log. Every write command has
 * exactly one, because "does this flag append or replace" is how concurrent
 * agent sessions destroy each other's accumulated reasoning.
 */
export function log(args: Args): number {
  const board = requireBoard();

  // `cairn log <id> "text"` and `cairn log "text"` (active task) both work.
  const [first, ...rest] = args.positional;
  const looksLikeId = first !== undefined && normalizeTaskId(first) !== null && rest.length > 0;
  const idArg = looksLikeId ? first : undefined;
  const text = (looksLikeId ? rest : args.positional).join(" ").trim();

  if (!text) {
    console.error(`usage: cairn log [<id>] "<kind>: <what> because <why>"`);
    console.error(dim(`  kinds: decided, dead end, note, question, answer, supersedes <log-id>`));
    return 2;
  }

  const task = resolveOrExplain(board, idArg);
  if (!task) return 1;

  const parsed = parseInput(text);
  const mechanism = flagString(args, "mechanism", "m");
  const evidence = flagString(args, "evidence", "e");

  const check = validate(parsed.kind, parsed.text, mechanism, evidence);
  if (!check.ok) {
    console.error(`${red("refused")} — ${check.reason}`);
    if (check.hint) console.error(`\n${dim(check.hint)}`);
    return 1;
  }

  if (parsed.supersedes) {
    const known = readLog(board, task.id).some((e) => e.id === parsed.supersedes);
    if (!known) {
      console.error(`${yellow("warning")} ${parsed.supersedes} is not an entry on ${task.id}`);
    }
  }

  const entry = withLock(board, () =>
    appendLog(board, task.id, {
      author: flagString(args, "author") ?? detectAuthor(),
      kind: parsed.kind,
      text: parsed.text,
      ...(mechanism ? { mechanism } : {}),
      ...(evidence ? { evidence } : {}),
      ...(parsed.supersedes ? { supersedes: parsed.supersedes } : {}),
    }),
  );

  console.log(`${green("+")} ${task.id}`);
  console.log(renderEntry(entry));
  if (mechanism?.trim().toLowerCase() === "unknown") {
    console.log(dim(`  recorded with an unknown mechanism — it will rank below explained entries`));
  }
  return 0;
}

/** Uncertainty gets a slot of its own so a model has somewhere to put it. */
export function ask(args: Args): number {
  const board = requireBoard();
  const [first, ...rest] = args.positional;
  const looksLikeId = first !== undefined && normalizeTaskId(first) !== null && rest.length > 0;
  const text = (looksLikeId ? rest : args.positional).join(" ").trim();
  if (!text) {
    console.error(`usage: cairn ask [<id>] "<question>"`);
    return 2;
  }
  const task = resolveOrExplain(board, looksLikeId ? first : undefined);
  if (!task) return 1;

  const entry = withLock(board, () =>
    appendLog(board, task.id, {
      author: flagString(args, "author") ?? detectAuthor(),
      kind: "question",
      text,
    }),
  );
  console.log(`${green("?")} ${task.id}  ${text}`);
  console.log(dim(`  shows in \`cairn context\` until answered:`));
  console.log(dim(`  cairn answer ${entry.id} "<decision>"`));
  return 0;
}

/** Answering marks the question answered without rewriting it. */
export function answer(args: Args): number {
  const board = requireBoard();
  const [logId, ...rest] = args.positional;
  const text = rest.join(" ").trim();
  if (!logId || !text) {
    console.error(`usage: cairn answer <log-id> "<decision>"`);
    return 2;
  }

  for (const task of listTasks(board)) {
    const entries = readLog(board, task.id);
    const question = entries.find((e) => e.id === logId.toLowerCase());
    if (!question) continue;
    // Append-only: the question is marked answered by a later line pointing at
    // it, never by rewriting the original entry.
    withLock(board, () =>
      appendLog(board, task.id, {
        author: flagString(args, "author") ?? detectAuthor(),
        kind: "answer",
        text,
        answered: true,
        supersedes: question.id,
      }),
    );
    console.log(`${green("✓")} ${task.id}  answered ${question.id}`);
    return 0;
  }

  console.error(`${red("not found")} — no question with id ${logId}`);
  return 1;
}
