import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Board } from "./board.js";

export const HOOK_VERSION = 1;
const MARKER = `# cairns:hook v${HOOK_VERSION}`;

export const HOOK_NAMES = ["prepare-commit-msg", "post-commit"] as const;
export type HookName = (typeof HOOK_NAMES)[number];

/**
 * The developer never types a task id. The trailer is what makes the task-to-code
 * file list a git query rather than stored state that rots.
 */
const PREPARE_COMMIT_MSG = `#!/bin/sh
${MARKER}
# Appends a "Task: <id>" trailer while a cairns task is active.
case "$2" in merge|squash) exit 0 ;; esac
[ -n "$CAIRNS_NO_TRAILER" ] && exit 0
root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
active="$root/.tasks/.active"
[ -f "$active" ] || exit 0
id=$(tr -d ' \\t\\r\\n' < "$active")
[ -n "$id" ] || exit 0
grep -qi "^Task: $id\\$" "$1" 2>/dev/null && exit 0
printf '\\nTask: %s\\n' "$id" >> "$1"
exit 0
`;

const POST_COMMIT = `#!/bin/sh
${MARKER}
# Refreshes the derived path index. Best effort — never blocks a commit.
command -v cairn >/dev/null 2>&1 || exit 0
(cairn reindex >/dev/null 2>&1 &)
exit 0
`;

const BODIES: Record<HookName, string> = {
  "prepare-commit-msg": PREPARE_COMMIT_MSG,
  "post-commit": POST_COMMIT,
};

export type HookResult = "created" | "updated" | "unchanged" | "chained" | "skipped";

export interface HookStatus {
  name: HookName;
  result: HookResult;
  path: string;
}

export function installHooks(board: Board): HookStatus[] {
  if (!board.gitDir) {
    return HOOK_NAMES.map((name) => ({ name, result: "skipped" as const, path: "" }));
  }
  const dir = join(board.gitDir, "hooks");
  mkdirSync(dir, { recursive: true });
  return HOOK_NAMES.map((name) => installOne(dir, name));
}

function installOne(dir: string, name: HookName): HookStatus {
  const path = join(dir, name);
  const body = BODIES[name];
  if (!existsSync(path)) {
    write(path, body);
    return { name, result: "created", path };
  }

  const current = readFileSync(path, "utf8");
  if (current.includes("cairns:hook")) {
    if (current === body) return { name, result: "unchanged", path };
    write(path, body);
    return { name, result: "updated", path };
  }

  // Someone else's hook already lives here. Preserve it and run it first rather
  // than clobbering it or refusing to install.
  const backup = `${path}.pre-cairns`;
  renameSync(path, backup);
  write(
    path,
    `#!/bin/sh
${MARKER}
# Chains a pre-existing hook that was here before cairns.
if [ -x "$0.pre-cairns" ]; then "$0.pre-cairns" "$@" || exit $?; fi
${body.split("\n").slice(2).join("\n")}`,
  );
  return { name, result: "chained", path };
}

function write(path: string, body: string): void {
  writeFileSync(path, body);
  try {
    chmodSync(path, 0o755);
  } catch {
    /* filesystems without an executable bit still work under `sh <hook>` */
  }
}

export function hooksInstalled(board: Board): boolean {
  if (!board.gitDir) return false;
  return HOOK_NAMES.every((name) => {
    const p = join(board.gitDir!, "hooks", name);
    return existsSync(p) && readFileSync(p, "utf8").includes("cairns:hook");
  });
}

const GITATTRIBUTES_LINE = ".tasks/**/log.ndjson merge=union";

/**
 * Union merge is what makes two agents in separate worktrees appending
 * concurrently produce both sets of lines instead of a conflict.
 */
export function installMergeDriver(board: Board): "created" | "updated" | "unchanged" {
  const p = join(board.root, ".gitattributes");
  const existing = existsSync(p) ? readFileSync(p, "utf8") : "";
  if (existing.includes(GITATTRIBUTES_LINE)) return "unchanged";
  const next = existing.replace(/\s*$/, "") ;
  writeFileSync(p, next ? `${next}\n${GITATTRIBUTES_LINE}\n` : `${GITATTRIBUTES_LINE}\n`);
  return existing ? "updated" : "created";
}
