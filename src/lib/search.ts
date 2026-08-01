import type { Board } from "./board.js";
import { type LogEntry, readLog, renderEntry, supersededIds } from "./log.js";
import { type Task, listTasks } from "./task.js";

export interface Hit {
  score: number;
  task: Task;
  entry?: LogEntry;
  /** The raw matched text, used for dedupe across storage locations. */
  text: string;
  /** Already carries date, author and task id — never render a bare snippet. */
  line: string;
}

const KIND_WEIGHT: Record<string, number> = {
  outcome: 3,
  "dead-end": 2.5,
  decided: 2,
  answer: 1.5,
  question: 1.2,
  note: 1,
};

function terms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[\s,]+/)
    .map((t) => t.replace(/^["']|["']$/g, ""))
    .filter((t) => t.length > 1);
}

function matchScore(haystack: string, needles: string[]): number {
  const h = haystack.toLowerCase();
  let score = 0;
  let matched = 0;
  for (const t of needles) {
    let idx = h.indexOf(t);
    if (idx < 0) continue;
    matched++;
    let count = 0;
    while (idx >= 0 && count < 4) {
      count++;
      idx = h.indexOf(t, idx + t.length);
    }
    score += count;
    // Word-boundary hits beat substring noise.
    if (new RegExp(`\\b${escapeRe(t)}`).test(h)) score += 1;
  }
  if (matched === 0) return 0;
  // Reward hits that cover more of the query.
  return score * (1 + (matched - 1) * 0.5);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export interface SearchOptions {
  limit?: number;
  includeOpen?: boolean;
}

export function search(board: Board, query: string, opts: SearchOptions = {}): Hit[] {
  const needles = terms(query);
  if (needles.length === 0) return [];
  const limit = opts.limit ?? 10;
  const hits: Hit[] = [];

  for (const task of listTasks(board)) {
    const closed = task.status === "done";
    const entries = readLog(board, task.id);
    const superseded = supersededIds(entries);

    for (const e of entries) {
      const haystack = [e.text, e.mechanism ?? "", e.evidence ?? ""].join(" ");
      const base = matchScore(haystack, needles);
      if (base === 0) continue;
      let score = base * (KIND_WEIGHT[e.kind] ?? 1);
      // A closed task's compacted outcome ranks above the raw attempts that led
      // to it, so the reader sees how it ended before what was tried.
      if (closed && e.kind === "outcome") score += 4;
      if (e.mechanism && e.mechanism.trim().toLowerCase() !== "unknown") score += 1.5;
      if (e.mechanism?.trim().toLowerCase() === "unknown") score -= 1;
      if (superseded.has(e.id)) score -= 4;
      hits.push({ score, task, entry: e, text: e.text, line: renderEntry(e, { task: true }) });
    }

    const fields: Array<[string, number, string]> = [
      [task.title, 2.5, "title"],
      [task.outcome, 3, "outcome"],
      [task.doneWhen.join(" · "), 1.5, "done when"],
      [task.notes.join(" · "), 1.5, "note"],
      [task.context, 1, "context"],
    ];
    for (const [text, weight, label] of fields) {
      if (!text) continue;
      const base = matchScore(text, needles);
      if (base === 0) continue;
      const score = base * weight + (closed && label === "outcome" ? 4 : 0);
      hits.push({
        score,
        task,
        text: firstLine(text),
        line: `- ${task.updated || task.created} · ${task.id} · ${label}: ${firstLine(text)}`,
      });
    }
  }

  hits.sort((a, b) => b.score - a.score || tsOf(b).localeCompare(tsOf(a)));

  // `cairn done` writes the outcome to both the task section and the log, so
  // dedupe on the text itself rather than on where it was found.
  const seen = new Set<string>();
  const out: Hit[] = [];
  for (const h of hits) {
    const key = `${h.task.id}:${h.text.replace(/\s+/g, " ").trim().slice(0, 120)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(h);
    if (out.length >= limit) break;
  }
  return out;
}

const tsOf = (h: Hit) => h.entry?.ts ?? h.task.updated ?? "";

function firstLine(s: string): string {
  const line = s.split("\n").find((l) => l.trim())?.trim() ?? "";
  return line.replace(/^[-*]\s+/, "");
}

/** Total hit count before truncation, so the caller can say what was dropped. */
export function countAll(board: Board, query: string): number {
  return search(board, query, { limit: Number.MAX_SAFE_INTEGER }).length;
}
