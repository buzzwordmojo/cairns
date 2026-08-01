import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { type Board, notesPath } from "./board.js";
import { git } from "./git.js";
import { readSection, writeSection } from "./sections.js";

/**
 * Project-wide notes. Deliberately called Notes and not Constraints: the
 * promotion gate that would give this tier authority (hash verification plus a
 * nomination queue) is not built yet, and an authority label over text that
 * nothing protects is worse than no tier at all.
 */
export const PROJECT_CAP = 15;
export const TASK_CAP = 7;

export interface Note {
  text: string;
  since?: string;
  recheckIf?: string;
  from?: string;
  /** Set when the recheck trigger names a repo path that has moved since. */
  stale?: boolean;
}

const META = /^\s*(?:since\s+([0-9-]{4,10}))?\s*(?:·\s*)?(?:from\s+(\S+))?\s*(?:·\s*)?(?:recheck-if:\s*(.+))?$/i;

export function parseNotes(text: string): Note[] {
  const out: Note[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    const item = /^\s*[-*]\s+(.*)$/.exec(line);
    if (item) {
      out.push({ text: item[1]!.trim() });
      continue;
    }
    const current = out[out.length - 1];
    if (!current) continue;
    const m = META.exec(line.trim());
    if (m && (m[1] || m[2] || m[3])) {
      if (m[1]) current.since = m[1];
      if (m[2]) current.from = m[2];
      if (m[3]) current.recheckIf = m[3].trim();
    } else {
      current.text = `${current.text} ${line.trim()}`;
    }
  }
  return out;
}

export function renderNotes(notes: Note[]): string {
  return notes
    .map((n) => {
      const meta = [
        n.since ? `since ${n.since}` : "",
        n.from ? `from ${n.from}` : "",
        n.recheckIf ? `recheck-if: ${n.recheckIf}` : "",
      ].filter(Boolean);
      return meta.length ? `- ${n.text}\n  ${meta.join(" · ")}` : `- ${n.text}`;
    })
    .join("\n");
}

export function readProjectNotes(board: Board): Note[] {
  const p = notesPath(board);
  if (!existsSync(p)) return [];
  return parseNotes(readSection(readFileSync(p, "utf8"), "notes"));
}

export function writeProjectNotes(board: Board, notes: Note[]): void {
  const p = notesPath(board);
  const existing = existsSync(p) ? readFileSync(p, "utf8") : "# Project notes\n";
  mkdirSync(board.dir, { recursive: true });
  writeFileSync(p, `${writeSection(existing, "notes", renderNotes(notes)).replace(/\s+$/, "")}\n`);
}

/**
 * The one place automation genuinely helps, because nobody manually audits
 * these. If the recheck trigger names a path in the repo and that path has moved
 * since the note was written, flag it as possibly stale rather than presenting
 * it as settled. Reports the fact; never computes a verdict.
 */
export function markStale(board: Board, notes: Note[]): Note[] {
  if (!board.gitDir) return notes;
  return notes.map((n) => {
    if (!n.recheckIf || !n.since) return n;
    const path = namedPath(board, n.recheckIf);
    if (!path) return n;
    const r = git(["log", "--oneline", `--since=${n.since}`, "--", path], board.root);
    const moved = r.ok && r.stdout.split("\n").some((l) => l.trim());
    return moved ? { ...n, stale: true } : n;
  });
}

function namedPath(board: Board, recheckIf: string): string | null {
  for (const token of recheckIf.split(/[\s,()]+/)) {
    const candidate = token.replace(/^[`'"]|[`'".,;]$/g, "");
    if (!candidate || !candidate.includes(".")) continue;
    if (existsSync(`${board.root}/${candidate}`)) return candidate;
  }
  return null;
}
