import { type Board, normalizePath } from "./board.js";
import { hasCairnsHook } from "./git.js";
import { getIndex } from "./index-cache.js";
import { type LogEntry, openQuestionEntries, readLog, supersededIds } from "./log.js";
import { type Task, listTasks } from "./task.js";

/** How a task got linked to the path. Never present a derived guess as a record. */
export type Method = "trailer" | "linked" | "targets";

export interface RelatedTask {
  task: Task;
  method: Method;
  commits: string[];
  findings: LogEntry[];
}

export interface RelatedResult {
  path: string;
  closed: RelatedTask[];
  open: RelatedTask[];
  hooksInstalled: boolean;
  trailerCommitsInRepo: number;
  /** True when nothing matched — the caller must say so out loud. */
  empty: boolean;
}

const FINDING_ORDER: Record<string, number> = {
  outcome: 0,
  "dead-end": 1,
  decided: 2,
  answer: 3,
  note: 4,
  question: 5,
};

export function related(board: Board, rawPath: string, opts: { rebuild?: boolean } = {}): RelatedResult {
  const path = normalizePath(board, rawPath);
  const idx = getIndex(board, { rebuild: opts.rebuild });
  const byTask = new Map<string, { method: Method; commits: string[] }>();

  for (const [file, tasks] of Object.entries(idx.paths)) {
    if (!pathMatches(file, path)) continue;
    for (const [taskId, shas] of Object.entries(tasks)) {
      const prev = byTask.get(taskId);
      if (prev) prev.commits.push(...shas);
      else byTask.set(taskId, { method: "trailer", commits: [...shas] });
    }
  }

  // Strongest provenance first: git said so, then a human said git said so, then
  // someone wrote it down before the work started.
  const all = listTasks(board);
  for (const t of all) {
    if (byTask.has(t.id)) continue;
    const hit = (paths: string[]) =>
      paths.some((p) => pathMatches(normalizePath(board, p), path));
    if (hit(t.linked)) byTask.set(t.id, { method: "linked", commits: [] });
    else if (hit(t.targets)) byTask.set(t.id, { method: "targets", commits: [] });
  }

  const rows: RelatedTask[] = [];
  for (const t of all) {
    const link = byTask.get(t.id);
    if (!link) continue;
    const entries = readLog(board, t.id);
    const superseded = supersededIds(entries);
    const stillOpen = new Set(openQuestionEntries(entries).map((e) => e.id));
    const findings = entries
      .filter((e) => !superseded.has(e.id) || stillOpen.has(e.id))
      .filter((e) => e.kind !== "question" || stillOpen.has(e.id))
      .sort(
        (a, b) =>
          (FINDING_ORDER[a.kind] ?? 9) - (FINDING_ORDER[b.kind] ?? 9) ||
          // Explanation beats an unknown mechanism, because it can be rechecked.
          Number(isUnknown(a)) - Number(isUnknown(b)) ||
          b.ts.localeCompare(a.ts),
      )
      .slice(0, 3);
    rows.push({ task: t, method: link.method, commits: dedupe(link.commits), findings });
  }

  const closed = rows.filter((r) => r.task.status === "done").sort(byRecency);
  const open = rows.filter((r) => r.task.status !== "done").sort(byRecency);
  const hooksInstalled = board.gitDir ? hasCairnsHook(board.gitDir, "prepare-commit-msg") : false;

  return {
    path,
    closed,
    open,
    hooksInstalled,
    trailerCommitsInRepo: Object.keys(idx.tasks).length,
    empty: rows.length === 0,
  };
}

/** Matches the file itself, or any file beneath it when the query is a directory. */
function pathMatches(candidate: string, query: string): boolean {
  if (candidate === query) return true;
  if (query.endsWith("/")) return candidate.startsWith(query);
  return candidate.startsWith(`${query}/`);
}

const byRecency = (a: RelatedTask, b: RelatedTask) =>
  (b.task.closed ?? b.task.updated ?? "").localeCompare(a.task.closed ?? a.task.updated ?? "");

const dedupe = (xs: string[]) => [...new Set(xs)];

const isUnknown = (e: LogEntry) => e.mechanism?.trim().toLowerCase() === "unknown";
