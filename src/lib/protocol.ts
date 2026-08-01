import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Board } from "./board.js";

export const PROTOCOL_VERSION = 1;

const BEGIN = "<!-- cairns:begin";
const END = "<!-- cairns:end -->";

/**
 * Under fifty lines, because this loads in every session in the repo and so
 * competes for the same budget the context command exists to protect.
 *
 * Deliberately carries no authority language about Notes. The promotion gate is
 * not built, so nothing here tells a model to trust that block over its own
 * reading of the code.
 */
export const PROTOCOL_BODY = `## Task board protocol

Work in this repo is tracked in \`.tasks/\`. Those files record what is being
built and why.

### Starting work
Run \`cairn context\`. It prints project notes, the active task, and the open
backlog. Notes are hand-written and unverified — weigh them against the code
rather than deferring to them.

### Before proposing an approach
Run \`cairn search <term>\`. Prior attempts and dead ends are recorded there.
Do not propose an approach the log records as failed unless you state why the
recorded reason no longer applies.

### While working
Append findings as you get them, not at the end:
  cairn log <id> "decided: <what> because <why>"
  cairn log <id> "dead end: <what failed> because <mechanism>"
  cairn log <id> "note: <fact discovered>"

- State the mechanism, not the verdict. Write "middleware runs after the
  response flushes", not "middleware doesn't work". Verdicts go stale
  invisibly; mechanisms can be rechecked.
- If you cannot state a because, you have a symptom, not a finding. Say so —
  \`--mechanism unknown --evidence "<pasted error>"\` is a valid entry.
- Never log status narration. Git already records what changed.
- One entry per finding.

### Finishing
A task is done when every line under "Done when" is verifiably true. If you
cannot verify a line, say so instead of marking it done.
  cairn done <id> --outcome "<what shipped; what a future reader needs>"

### Never
- Do not delete or rewrite log entries. Overturn instead:
  cairn log <id> "supersedes <log-id>: <what is true now> because <why>"
- Do not hand-edit \`.tasks/*/log.ndjson\`. It is append-only.

### Uncertainty
If you need a human decision, do not guess:
  cairn ask <id> "<question>"
The question appears in default context until answered.`;

export type InstallResult = "created" | "updated" | "unchanged";

export interface ProtocolStatus {
  file: string;
  result: InstallResult;
  previousVersion: number | null;
}

/** Prefers whichever convention the repo already uses; falls back to CLAUDE.md. */
export function targetFile(board: Board): string {
  for (const name of ["AGENTS.md", "CLAUDE.md"]) {
    if (existsSync(join(board.root, name))) return join(board.root, name);
  }
  return join(board.root, "CLAUDE.md");
}

export function installedVersion(text: string): number | null {
  const m = new RegExp(`${BEGIN}\\s+v(\\d+)\\s*-->`).exec(text);
  return m ? Number(m[1]) : null;
}

function block(): string {
  return `${BEGIN} v${PROTOCOL_VERSION} -->\n${PROTOCOL_BODY}\n${END}`;
}

/** Strip and reinsert at the same position, preserving everything around it. */
export function installProtocol(board: Board, file = targetFile(board)): ProtocolStatus {
  const existing = existsSync(file) ? readFileSync(file, "utf8") : "";
  const previousVersion = installedVersion(existing);
  const start = existing.indexOf(BEGIN);
  const endIdx = existing.indexOf(END);

  if (start >= 0 && endIdx > start) {
    const current = existing.slice(start, endIdx + END.length);
    if (current === block()) return { file, result: "unchanged", previousVersion };
    const next = existing.slice(0, start) + block() + existing.slice(endIdx + END.length);
    writeFileSync(file, next);
    return { file, result: "updated", previousVersion };
  }

  const prefix = existing.replace(/\s+$/, "");
  const next = prefix ? `${prefix}\n\n${block()}\n` : `${block()}\n`;
  writeFileSync(file, next);
  return { file, result: existing ? "updated" : "created", previousVersion };
}

/** Read the marker rather than only writing it — warn when the block is stale. */
export function protocolDrift(board: Board): { file: string; version: number } | null {
  for (const name of ["AGENTS.md", "CLAUDE.md"]) {
    const p = join(board.root, name);
    if (!existsSync(p)) continue;
    const v = installedVersion(readFileSync(p, "utf8"));
    if (v !== null && v < PROTOCOL_VERSION) return { file: p, version: v };
  }
  return null;
}

export function protocolInstalled(board: Board): boolean {
  for (const name of ["AGENTS.md", "CLAUDE.md"]) {
    const p = join(board.root, name);
    if (existsSync(p) && installedVersion(readFileSync(p, "utf8")) !== null) return true;
  }
  return false;
}
