import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { type Board, hasLegacyLayout, indexPath } from "./board.js";
import { commitsWithTaskTrailer, headSha } from "./git.js";

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
  // Read HEAD before the log, so a commit landing mid-build makes the index look
  // older than it is — never newer.
  const head = headSha(board.root) ?? "";
  const commits = commitsWithTaskTrailer(board.root);
  const idx: PathIndex = { built: new Date().toISOString(), head, paths: {}, tasks: {} };
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

/** Set when the answer came from an index older than HEAD and it could not be rebuilt. */
export interface Staleness {
  /** The commit the index was built at, or null when there was never an index. */
  head: string | null;
  built: string | null;
  current: string;
  reason: string;
}

export interface IndexResult {
  index: PathIndex;
  stale: Staleness | null;
}

export function getIndex(board: Board, opts: { rebuild?: boolean } = {}): PathIndex {
  return getFreshIndex(board, opts).index;
}

/**
 * The cache is trusted only while it was built at the current HEAD. The
 * post-commit hook that refreshes it discards its own failure by design, so a
 * frozen index is detected here instead — and when it cannot be rebuilt either,
 * the answer is still given but carries where it came from.
 */
export function getFreshIndex(board: Board, opts: { rebuild?: boolean } = {}): IndexResult {
  const cached = opts.rebuild ? null : loadIndex(board);
  // Without git there is no HEAD to compare against and nothing to rebuild from.
  if (!board.gitDir) return { index: cached ?? EMPTY, stale: null };

  const current = headSha(board.root) ?? "";
  if (cached && cached.head && cached.head === current) return { index: cached, stale: null };

  // `cairn reindex` refuses a board that needs migrate; the cache follows the
  // same rule rather than quietly maintaining state for a layout it rejects.
  const refusal = hasLegacyLayout(board) ? "the board needs `cairn migrate`" : null;
  let built: PathIndex | null = null;
  let reason = refusal;
  if (!refusal) {
    try {
      built = buildIndex(board);
    } catch (e) {
      reason = e instanceof Error ? e.message : String(e);
    }
  }

  if (!built) {
    const fallback = cached ?? loadIndex(board);
    return {
      index: fallback ?? EMPTY,
      stale: {
        head: fallback ? fallback.head || null : null,
        built: fallback ? fallback.built || null : null,
        current,
        reason: reason ?? "the index could not be rebuilt",
      },
    };
  }

  try {
    saveIndex(board, built);
  } catch {
    /* an unwritable cache must not fail the query it was meant to speed up */
  }
  return { index: built, stale: null };
}
