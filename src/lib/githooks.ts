import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { Board } from "./board.js";

export const HOOK_VERSION = 2;
const MARKER = `# cairns:hook v${HOOK_VERSION}`;

export const HOOK_NAMES = ["prepare-commit-msg", "post-commit"] as const;
export type HookName = (typeof HOOK_NAMES)[number];

/**
 * The developer never types a task id. The trailer is what makes the task-to-code
 * file list a git query rather than stored state that rots.
 */
const PREPARE_COMMIT_MSG = `#!/bin/sh
${MARKER}
# Appends a "Task: <id>" trailer so the task-to-code link stays a git query.
case "$2" in merge|squash) exit 0 ;; esac
[ -n "$CAIRNS_NO_TRAILER" ] && exit 0
root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0

id=""
active="$root/.tasks/.active"
[ -f "$active" ] && id=$(tr -d ' \\t\\r\\n' < "$active")

# Falling back to the branch name costs nothing for anyone who branches per task.
# An explicit start still wins, and a candidate without a task directory is
# discarded — otherwise a branch like hotfix-t-shirt-sizing links to nothing.
if [ -z "$id" ]; then
  branch=$(git symbolic-ref --quiet --short HEAD 2>/dev/null) || branch=""
  guess=$(printf '%s' "$branch" | grep -oE '(^|[/_.-])t-[0-9a-z]{1,32}' | head -n 1 | sed 's/^[^t]//')
  if [ -n "$guess" ] && [ -d "$root/.tasks/$guess" ]; then id="$guess"; fi
fi

# The silent skip is what loses the link: hooks install, work gets committed, and
# the index is still empty weeks later with nothing ever having said so. Warn on
# a message a human is composing, and stay quiet where one is being replayed.
# Rebase and cherry-pick both report "$2" as "message", exactly like git commit
# -m, so the sequencer state is the only thing that tells them apart.
if [ -z "$id" ] && [ -z "$CAIRNS_QUIET" ]; then
  gd=$(git rev-parse --git-dir 2>/dev/null) || gd=""
  replaying=""
  for f in rebase-merge rebase-apply CHERRY_PICK_HEAD REVERT_HEAD MERGE_HEAD; do
    [ -e "$gd/$f" ] && replaying=1
  done
  if [ -z "$replaying" ]; then
    case "$2" in
      ""|message|template)
        echo "cairns: no active task — this commit will not link to one." >&2
        echo "        fix: cairn start <id>   silence: CAIRNS_QUIET=1" >&2
        ;;
    esac
  fi
fi
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

  const backup = `${path}.pre-cairns`;
  const current = readFileSync(path, "utf8");
  if (current.includes("cairns:hook")) {
    // Upgrading a chained hook has to stay chained. Writing the plain body would
    // leave the backup on disk and nothing calling it — someone else's hook
    // silently stops running, which is the worst way for an upgrade to fail.
    const wanted = existsSync(backup) ? chained(body) : body;
    if (current === wanted) return { name, result: "unchanged", path };
    write(path, wanted);
    return { name, result: existsSync(backup) ? "chained" : "updated", path };
  }

  // Someone else's hook already lives here. Preserve it and run it first rather
  // than clobbering it or refusing to install.
  renameSync(path, backup);
  write(path, chained(body));
  return { name, result: "chained", path };
}

function chained(body: string): string {
  return `#!/bin/sh
${MARKER}
# Chains a pre-existing hook that was here before cairns.
if [ -x "$0.pre-cairns" ]; then "$0.pre-cairns" "$@" || exit $?; fi
${body.split("\n").slice(2).join("\n")}`;
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
/** Marked like every other artifact, so removing cairns is a mechanical edit. */
const GITATTRIBUTES_MARKER = "# cairns:attributes";
const GITATTRIBUTES_BLOCK = `${GITATTRIBUTES_MARKER}\n${GITATTRIBUTES_LINE}`;

/**
 * Union merge is what makes two agents in separate worktrees appending
 * concurrently produce both sets of lines instead of a conflict.
 */
export function installMergeDriver(board: Board): "created" | "updated" | "unchanged" {
  const p = join(board.root, ".gitattributes");
  const existing = existsSync(p) ? readFileSync(p, "utf8") : "";
  if (existing.includes(GITATTRIBUTES_MARKER)) return "unchanged";
  // An unmarked line from an older install still counts; mark it in place.
  const stripped = existing
    .split("\n")
    .filter((l) => l.trim() !== GITATTRIBUTES_LINE)
    .join("\n")
    .replace(/\s*$/, "");
  writeFileSync(p, stripped ? `${stripped}\n\n${GITATTRIBUTES_BLOCK}\n` : `${GITATTRIBUTES_BLOCK}\n`);
  return existing ? "updated" : "created";
}

/** Drops the marked block and leaves every other rule untouched. */
export function removeMergeDriver(board: Board): boolean {
  const p = join(board.root, ".gitattributes");
  if (!existsSync(p)) return false;
  const lines = readFileSync(p, "utf8").split("\n");
  const kept = lines.filter(
    (l) => l.trim() !== GITATTRIBUTES_MARKER && l.trim() !== GITATTRIBUTES_LINE,
  );
  if (kept.length === lines.length) return false;
  const body = kept.join("\n").replace(/\s*$/, "");
  if (body) writeFileSync(p, `${body}\n`);
  else unlinkSync(p);
  return true;
}

export type HookRemoval = { name: HookName; result: "removed" | "restored" | "absent" | "foreign" };

/**
 * Only removes hooks cairns actually wrote. A hook without the marker belongs to
 * someone else, and silently deleting it would be a far worse failure than
 * leaving a stale one behind.
 */
export function removeHooks(board: Board): HookRemoval[] {
  if (!board.gitDir) return HOOK_NAMES.map((name) => ({ name, result: "absent" as const }));
  return HOOK_NAMES.map((name) => {
    const path = join(board.gitDir!, "hooks", name);
    if (!existsSync(path)) return { name, result: "absent" as const };
    if (!readFileSync(path, "utf8").includes("cairns:hook")) {
      return { name, result: "foreign" as const };
    }
    const backup = `${path}.pre-cairns`;
    if (existsSync(backup)) {
      renameSync(backup, path);
      return { name, result: "restored" as const };
    }
    unlinkSync(path);
    return { name, result: "removed" as const };
  });
}
