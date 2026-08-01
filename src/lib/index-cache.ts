import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { type Board, indexPath } from "./board.js";
import { commitsWithTaskTrailer } from "./git.js";

export interface PathIndex {
  built: string;
  head: string;
  /** path → task id → commit shas */
  paths: Record<string, Record<string, string[]>>;
  tasks: Record<string, string[]>;
}

const EMPTY: PathIndex = { built: "", head: "", paths: {}, tasks: {} };

/**
 * A cache, never a source of truth. Every query returns the same answer with the
 * index absent — just slower. It is gitignored, because derived state in the repo
 * would invent a new class of merge conflict.
 */
export function buildIndex(board: Board): PathIndex {
  const commits = commitsWithTaskTrailer(board.root);
  const idx: PathIndex = { built: new Date().toISOString(), head: "", paths: {}, tasks: {} };
  for (const c of commits) {
    const files = (idx.tasks[c.task] ??= []);
    for (const f of c.files) {
      const byTask = (idx.paths[f] ??= {});
      (byTask[c.task] ??= []).push(c.sha);
      if (!files.includes(f)) files.push(f);
    }
  }
  return idx;
}

export function saveIndex(board: Board, idx: PathIndex): void {
  const p = indexPath(board);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(idx));
}

export function loadIndex(board: Board): PathIndex | null {
  const p = indexPath(board);
  if (!existsSync(p)) return null;
  try {
    const parsed = JSON.parse(readFileSync(p, "utf8")) as PathIndex;
    if (!parsed || typeof parsed !== "object" || !parsed.paths) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function getIndex(board: Board, opts: { rebuild?: boolean } = {}): PathIndex {
  if (!opts.rebuild) {
    const cached = loadIndex(board);
    if (cached) return cached;
  }
  if (!board.gitDir) return EMPTY;
  const built = buildIndex(board);
  try {
    saveIndex(board, built);
  } catch {
    /* an unwritable cache must not fail the query it was meant to speed up */
  }
  return built;
}
