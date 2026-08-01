import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { type Board, logPath } from "./board.js";
import { newLogId } from "./ids.js";

export type LogKind = "decided" | "dead-end" | "note" | "outcome" | "question" | "answer";

export interface LogEntry {
  id: string;
  ts: string;
  task: string;
  author: string;
  kind: LogKind;
  text: string;
  /** `unknown` is a first-class value — honest vagueness outranks confabulation. */
  mechanism?: string;
  evidence?: string;
  supersedes?: string;
  answered?: boolean;
  [key: string]: unknown;
}

const KIND_PREFIXES: Array<[RegExp, LogKind]> = [
  [/^decided\s*:\s*/i, "decided"],
  [/^dead[ -]?end\s*:\s*/i, "dead-end"],
  [/^outcome\s*:\s*/i, "outcome"],
  [/^question\s*:\s*/i, "question"],
  [/^answer\s*:\s*/i, "answer"],
  [/^note\s*:\s*/i, "note"],
];

const SUPERSEDES = /^supersedes\s+(l-[0-9a-z]+)\s*:\s*/i;

export interface ParsedInput {
  kind: LogKind;
  text: string;
  supersedes?: string;
}

/** `"dead end: X because Y"` → `{kind: "dead-end", text: "X because Y"}`. */
export function parseInput(raw: string): ParsedInput {
  let s = raw.trim();
  let supersedes: string | undefined;
  const sup = SUPERSEDES.exec(s);
  if (sup) {
    supersedes = sup[1]!.toLowerCase();
    s = s.slice(sup[0].length).trim();
  }
  for (const [re, kind] of KIND_PREFIXES) {
    if (re.test(s)) return { kind, text: s.replace(re, "").trim(), supersedes };
  }
  return { kind: supersedes ? "decided" : "note", text: s, supersedes };
}

export interface Validation {
  ok: boolean;
  reason?: string;
  hint?: string;
}

/**
 * Enforces the form, and deliberately does not try to enforce the truth. A
 * string check for "because" selects for syntactically compliant confabulation,
 * so an explicit `mechanism: unknown` carrying evidence is accepted as-is.
 */
export function validate(
  kind: LogKind,
  text: string,
  mechanism?: string,
  evidence?: string,
): Validation {
  if (!text.trim()) return { ok: false, reason: "empty entry" };
  if (kind !== "decided" && kind !== "dead-end") return { ok: true };

  const hasBecause = /\b(because|since|due to)\b/i.test(text);
  const hasMechanism = Boolean(mechanism?.trim());
  const hasEvidence = Boolean(evidence?.trim());

  if (hasBecause || hasMechanism) return { ok: true };
  if (hasEvidence) return { ok: true };

  return {
    ok: false,
    reason: `a "${kind}" entry needs a mechanism, not a verdict`,
    hint: [
      "State why, in a form someone can recheck:",
      `  cairn log <id> "${kind === "dead-end" ? "dead end" : "decided"}: ${text.slice(0, 40)}… because <mechanism>"`,
      "",
      "If you genuinely do not know the mechanism, say so and attach evidence:",
      `  cairn log <id> "…" --mechanism unknown --evidence "<pasted error / failing command>"`,
    ].join("\n"),
  };
}

export function detectAuthor(): string {
  const explicit = process.env.CAIRNS_AUTHOR?.trim();
  if (explicit) return explicit;
  if (process.env.CLAUDECODE || process.env.CLAUDE_CODE || process.env.CAIRNS_AGENT) return "agent";
  return "human";
}

/** Spelled out rather than `Omit<LogEntry, …>`: the index signature on LogEntry
 * makes Omit collapse to the index signature alone and drop the required keys. */
export interface NewLogEntry {
  author: string;
  kind: LogKind;
  text: string;
  mechanism?: string;
  evidence?: string;
  supersedes?: string;
  answered?: boolean;
}

export function appendLog(board: Board, task: string, entry: NewLogEntry): LogEntry {
  const full: LogEntry = {
    id: newLogId(),
    ts: new Date().toISOString(),
    task,
    ...entry,
  };
  const p = logPath(board, task);
  mkdirSync(dirname(p), { recursive: true });
  // Append-only, one object per line, so `merge=union` resolves concurrent
  // writers into the union of both sets instead of a conflict.
  appendFileSync(p, `${JSON.stringify(full)}\n`);
  return full;
}

/** A malformed line is skipped, never fatal — the rest of the log still reads. */
export function readLog(board: Board, task: string): LogEntry[] {
  const p = logPath(board, task);
  if (!existsSync(p)) return [];
  const out: LogEntry[] = [];
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const s = line.trim();
    if (!s || !s.startsWith("{")) continue;
    try {
      const obj = JSON.parse(s) as LogEntry;
      if (obj && typeof obj.text === "string") out.push({ ...obj, task });
    } catch {
      continue;
    }
  }
  out.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  return out;
}

export function supersededIds(entries: LogEntry[]): Set<string> {
  const out = new Set<string>();
  for (const e of entries) if (e.supersedes) out.add(e.supersedes);
  return out;
}

/** A question is answered when a later entry points back at it. */
export function openQuestionEntries(entries: LogEntry[]): LogEntry[] {
  const answered = new Set<string>();
  for (const e of entries) {
    if (e.kind === "answer" && e.supersedes) answered.add(e.supersedes);
  }
  return entries.filter((e) => e.kind === "question" && !answered.has(e.id));
}

export const shortDate = (ts: string) => (ts || "").slice(0, 10);

export function kindLabel(kind: LogKind): string {
  return kind === "dead-end" ? "dead end" : kind;
}

/** Every rendered line carries date, author and task id — never strip them. */
export function renderEntry(e: LogEntry, opts: { task?: boolean } = {}): string {
  const parts = [shortDate(e.ts), e.author, `${kindLabel(e.kind)}: ${e.text}`];
  if (opts.task) parts.splice(2, 0, e.task);
  let line = `- ${parts.join(" · ")}`;
  if (e.mechanism) line += `\n    mechanism: ${e.mechanism}`;
  if (e.evidence) line += `\n    evidence: ${e.evidence.split("\n")[0]}`;
  if (e.supersedes) line += `\n    supersedes: ${e.supersedes}`;
  return `${line}  [${e.id}]`;
}
