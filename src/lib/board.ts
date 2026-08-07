import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { gitCommonDir, repoRoot } from "./git.js";

export const BOARD_DIR = ".tasks";
/**
 * Tasks live one level below the board root so `.tasks/` keeps a fixed listing.
 * A git host renders README.md *under* the directory listing of the folder that
 * holds it, so with tasks as siblings the board page sank further off-screen with
 * every task added. Nested, the listing above the page is the same height at 40
 * tasks and at 4000.
 */
export const TASKS_DIR = "tasks";
export const TASK_FILE = "task.md";
export const LOG_FILE = "log.ndjson";
export const NOTES_FILE = "NOTES.md";

export class BoardError extends Error {}

export interface Board {
  /** Repo root, or the directory holding `.tasks/` when git is absent. */
  root: string;
  dir: string;
  gitDir: string | null;
}

function findUp(start: string, name: string): string | null {
  let cur = resolve(start);
  for (;;) {
    if (existsSync(join(cur, name))) return cur;
    const parent = dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
}

/** Locates the board without requiring one to exist yet. */
export function locate(cwd = process.cwd()): Board {
  const root = findUp(cwd, BOARD_DIR) ?? repoRoot(cwd) ?? resolve(cwd);
  return { root, dir: join(root, BOARD_DIR), gitDir: gitCommonDir(root) };
}

export function requireBoard(cwd = process.cwd(), opts: { allowLegacy?: boolean } = {}): Board {
  const board = locate(cwd);
  if (!existsSync(board.dir)) {
    throw new BoardError(`no board found. Run \`cairn init\` in your repo root.`);
  }
  // Refusing is the point. Reading the old layout too would work today and would
  // mean the flat listing — the whole reason for the move — never actually goes away.
  if (!opts.allowLegacy && hasLegacyLayout(board)) {
    throw new BoardError(
      `this board still keeps tasks directly in ${BOARD_DIR}/. Run \`cairn migrate\` once to move them into ${BOARD_DIR}/${TASKS_DIR}/.`,
    );
  }
  return board;
}

export const tasksRoot = (b: Board) => join(b.dir, TASKS_DIR);
// Pure joins, deliberately. A closed task is still written to — the protocol
// overturns a stale finding by appending a `supersedes` entry to it years later —
// so log resolution stays on the hot path forever and must never pay a stat.
export const taskDir = (b: Board, id: string) => join(b.dir, TASKS_DIR, id);
export const taskPath = (b: Board, id: string) => join(b.dir, TASKS_DIR, id, TASK_FILE);
export const logPath = (b: Board, id: string) => join(b.dir, TASKS_DIR, id, LOG_FILE);
export const notesPath = (b: Board) => join(b.dir, NOTES_FILE);
export const activePath = (b: Board) => join(b.dir, ".active");
export const indexPath = (b: Board) => join(b.dir, ".index", "paths.json");
export const inboxPath = (b: Board) => join(b.dir, "INBOX.md");

function taskDirNamesIn(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith("t-"))
    .filter((e) => existsSync(join(dir, e.name, TASK_FILE)))
    .map((e) => e.name)
    .sort();
}

export function listTaskIds(b: Board): string[] {
  return taskDirNamesIn(tasksRoot(b));
}

/**
 * Boards written before tasks were nested keep them as siblings of the page.
 * Detected rather than silently read, because a resolver that accepts both
 * layouts never stops accepting both.
 */
export function legacyTaskIds(b: Board): string[] {
  return taskDirNamesIn(b.dir);
}

export const hasLegacyLayout = (b: Board) => legacyTaskIds(b).length > 0;

export function readActive(b: Board): string | null {
  const p = activePath(b);
  if (!existsSync(p)) return null;
  const v = readFileSync(p, "utf8").trim();
  return v || null;
}

export function writeActive(b: Board, id: string | null): void {
  mkdirSync(b.dir, { recursive: true });
  writeFileSync(activePath(b), id ? `${id}\n` : "");
}

/** Repo-relative, forward-slashed — the form git reports and the index keys on. */
export function normalizePath(b: Board, input: string): string {
  const abs = resolve(process.cwd(), input);
  const rel = relative(b.root, abs);
  if (!rel || rel.startsWith("..")) return input.split(sep).join("/").replace(/^\.\//, "");
  return rel.split(sep).join("/");
}
