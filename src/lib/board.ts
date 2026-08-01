import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { gitCommonDir, repoRoot } from "./git.js";

export const BOARD_DIR = ".tasks";
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

export function requireBoard(cwd = process.cwd()): Board {
  const board = locate(cwd);
  if (!existsSync(board.dir)) {
    throw new BoardError(`no board found. Run \`cairn init\` in your repo root.`);
  }
  return board;
}

export const taskDir = (b: Board, id: string) => join(b.dir, id);
export const taskPath = (b: Board, id: string) => join(b.dir, id, TASK_FILE);
export const logPath = (b: Board, id: string) => join(b.dir, id, LOG_FILE);
export const notesPath = (b: Board) => join(b.dir, NOTES_FILE);
export const activePath = (b: Board) => join(b.dir, ".active");
export const indexPath = (b: Board) => join(b.dir, ".index", "paths.json");
export const inboxPath = (b: Board) => join(b.dir, "INBOX.md");

export function listTaskIds(b: Board): string[] {
  if (!existsSync(b.dir)) return [];
  return readdirSync(b.dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith("t-"))
    .filter((e) => existsSync(join(b.dir, e.name, TASK_FILE)))
    .map((e) => e.name)
    .sort();
}

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
