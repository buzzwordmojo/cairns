import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { type Board, listTaskIds, taskPath } from "./board.js";
import { Frontmatter, parseDocument, serializeDocument } from "./frontmatter.js";
import { newTaskId } from "./ids.js";
import { readSection, readSectionLines, writeSection } from "./sections.js";

export const FORMAT_VERSION = "1";

export type Status = "open" | "doing" | "done";

export interface Task {
  id: string;
  title: string;
  status: Status;
  created: string;
  updated: string;
  closed?: string;
  /** Intent, written at creation. Never merged with `touched`, which git derives. */
  targets: string[];
  plan: { path?: string; stamped?: string };
  doneWhen: string[];
  context: string;
  notes: string[];
  questions: string[];
  outcome: string;
  fm: Frontmatter;
  body: string;
  path: string;
}

const STATUSES: Status[] = ["open", "doing", "done"];

function coerceStatus(raw: string | undefined): Status {
  const s = (raw ?? "").trim().toLowerCase();
  if (STATUSES.includes(s as Status)) return s as Status;
  if (s === "closed" || s === "complete" || s === "completed") return "done";
  if (s === "active" || s === "in-progress" || s === "wip") return "doing";
  return "open";
}

export const today = () => new Date().toISOString().slice(0, 10);

export function readTask(board: Board, id: string): Task | null {
  const p = taskPath(board, id);
  if (!existsSync(p)) return null;
  return parseTask(readFileSync(p, "utf8"), p, id);
}

export function parseTask(text: string, path: string, fallbackId: string): Task {
  const { fm, body } = parseDocument(text);
  return {
    id: fm.getOr("id", fallbackId),
    title: fm.getOr("title", fallbackId),
    status: coerceStatus(fm.get("status")),
    created: fm.getOr("created", ""),
    updated: fm.getOr("updated", ""),
    closed: fm.get("closed"),
    targets: fm.getList("targets"),
    plan: fm.getMap("plan"),
    doneWhen: readSectionLines(body, "done-when"),
    context: readSection(body, "context"),
    notes: readSectionLines(body, "notes"),
    questions: readSectionLines(body, "questions"),
    outcome: readSection(body, "outcome"),
    fm,
    body,
    path,
  };
}

export function writeTask(task: Task): void {
  task.fm.set("version", FORMAT_VERSION);
  task.fm.set("id", task.id);
  task.fm.set("title", task.title);
  task.fm.set("status", task.status);
  task.fm.set("created", task.created || today());
  task.fm.set("updated", today());
  if (task.closed) task.fm.set("closed", task.closed);
  if (task.targets.length) task.fm.set("targets", task.targets);
  if (task.plan.path) task.fm.set("plan", task.plan as Record<string, string>);
  mkdirSync(dirname(task.path), { recursive: true });
  writeFileSync(task.path, serializeDocument(task.fm, task.body));
}

export interface CreateOptions {
  title: string;
  status?: Status;
  targets?: string[];
  doneWhen?: string[];
  context?: string;
}

/**
 * Random ids make a collision unlikely; this makes it impossible to *lose* a
 * task to one. Callers hold the board lock, so an existing directory means the
 * id is genuinely taken rather than half-written by us.
 */
function allocateId(board: Board): string {
  for (let i = 0; i < 100; i++) {
    const id = newTaskId();
    if (!existsSync(taskPath(board, id))) return id;
  }
  throw new Error("could not allocate a free task id");
}

export function createTask(board: Board, opts: CreateOptions): Task {
  const id = allocateId(board);
  let body = "";
  body = writeSection(body, "done-when", (opts.doneWhen ?? []).map((l) => `- ${l}`).join("\n"));
  body = writeSection(body, "context", opts.context ?? "");
  const task: Task = {
    id,
    title: opts.title,
    status: opts.status ?? "open",
    created: today(),
    updated: today(),
    targets: opts.targets ?? [],
    plan: {},
    doneWhen: opts.doneWhen ?? [],
    context: opts.context ?? "",
    notes: [],
    questions: [],
    outcome: "",
    fm: new Frontmatter(),
    body,
    path: taskPath(board, id),
  };
  writeTask(task);
  return task;
}

export function listTasks(board: Board): Task[] {
  return listTaskIds(board)
    .map((id) => readTask(board, id))
    .filter((t): t is Task => t !== null);
}

/** Accepts a full id or any unambiguous prefix. */
export function resolveTask(board: Board, input: string): Task | { ambiguous: string[] } | null {
  const q = input.trim().toLowerCase();
  if (!q) return null;
  const withPrefix = q.startsWith("t-") ? q : `t-${q}`;
  const direct = readTask(board, withPrefix);
  if (direct) return direct;
  const matches = listTaskIds(board).filter((id) => id.startsWith(withPrefix));
  if (matches.length === 1) return readTask(board, matches[0]!);
  if (matches.length > 1) return { ambiguous: matches };
  return null;
}

export const isOpen = (t: Task) => t.status !== "done";
