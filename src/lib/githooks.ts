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
import { git } from "./git.js";

export const HOOK_VERSION = 3;
const MARKER = `# cairns:hook v${HOOK_VERSION}`;

export const HOOK_NAMES = ["prepare-commit-msg", "post-commit", "post-merge"] as const;
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

/**
 * The one moment the committed board page is guaranteed stale through nobody's
 * action: both sides changed `.tasks/`, and the merge driver deliberately kept
 * one side's page rather than inventing a merged one. This runs once the working
 * directory is whole, which is the earliest point a correct render is possible.
 */
const POST_MERGE = `#!/bin/sh
${MARKER}
# Re-renders the board page after a merge. Announces itself, because it leaves a
# modified file behind and a silent one would look like a dirty tree from nowhere.
command -v cairn >/dev/null 2>&1 || exit 0
root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
[ -d "$root/.tasks" ] || exit 0
cairn render --check >/dev/null 2>&1 && exit 0
if cairn render >/dev/null 2>&1; then
  echo "cairns: re-rendered .tasks/README.md after the merge — commit it." >&2
fi
exit 0
`;

const BODIES: Record<HookName, string> = {
  "prepare-commit-msg": PREPARE_COMMIT_MSG,
  "post-commit": POST_COMMIT,
  "post-merge": POST_MERGE,
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

export const ATTRIBUTES_VERSION = 2;
/** Marked like every other artifact, so removing cairns is a mechanical edit. */
const GITATTRIBUTES_MARKER = "# cairns:attributes";

export const BOARD_MERGE_DRIVER = "cairns-board";

const GITATTRIBUTES_LINES = [
  ".tasks/**/log.ndjson merge=union",
  ".tasks/**/log.ndjson linguist-generated=true",
  `.tasks/README.md merge=${BOARD_MERGE_DRIVER}`,
  ".tasks/README.md linguist-generated=true",
];

/** Every line any version of cairns has written here, so an upgrade can replace
 * the whole block instead of appending a second one. */
const RETIRED_LINES = [".tasks/**/log.ndjson merge=union"];

const GITATTRIBUTES_BLOCK = `${GITATTRIBUTES_MARKER} v${ATTRIBUTES_VERSION}\n${GITATTRIBUTES_LINES.join("\n")}`;

function stripBlock(text: string): string {
  const known = new Set([...GITATTRIBUTES_LINES, ...RETIRED_LINES]);
  return text
    .split("\n")
    .filter((l) => !l.trim().startsWith(GITATTRIBUTES_MARKER) && !known.has(l.trim()))
    .join("\n")
    .replace(/\s*$/, "");
}

/**
 * Union merge is what makes two agents in separate worktrees appending
 * concurrently produce both sets of lines instead of a conflict. The board page
 * is derived, so it is never merged at all — the driver regenerates it.
 *
 * Versioned because the marker used to be an unconditional early return: an
 * install that already had the v1 marker could never receive a rule added later.
 */
export function installMergeDriver(board: Board): "created" | "updated" | "unchanged" {
  const p = join(board.root, ".gitattributes");
  const existing = existsSync(p) ? readFileSync(p, "utf8") : "";
  if (existing.includes(`${GITATTRIBUTES_MARKER} v${ATTRIBUTES_VERSION}`)) return "unchanged";
  const stripped = stripBlock(existing);
  writeFileSync(p, stripped ? `${stripped}\n\n${GITATTRIBUTES_BLOCK}\n` : `${GITATTRIBUTES_BLOCK}\n`);
  return existing.trim() ? "updated" : "created";
}

/**
 * The board page is fully derived, so a three-way text merge of it is work with
 * no upside — and asking a human to resolve a conflict in a generated file is
 * worse than no upside. `true` exits zero leaving `%A` untouched, which takes
 * our side: never a conflict, and never a half-merged page.
 *
 * It deliberately does not regenerate. Git runs merge drivers while merging file
 * contents, before the rest of the merged tree reaches the working directory, so
 * a driver that rendered would read a tree that is not there yet and produce a
 * confidently wrong page. The post-merge hook regenerates instead, once the
 * working directory is whole.
 *
 * Registered per clone, like the hooks. A clone that skipped `cairn init` has no
 * driver by that name and git falls back to an ordinary conflict — visible, and
 * fixed by running `cairn render`.
 */
export function installBoardDriver(board: Board): boolean {
  if (!board.gitDir) return false;
  const cfg = (key: string, value: string) =>
    git(["config", `merge.${BOARD_MERGE_DRIVER}.${key}`, value], board.root, { write: true }).ok;
  return (
    cfg("name", "keep the generated cairns board page, then re-render it post-merge") &&
    cfg("driver", "true")
  );
}

export function removeBoardDriver(board: Board): boolean {
  if (!board.gitDir) return false;
  return git(["config", "--remove-section", `merge.${BOARD_MERGE_DRIVER}`], board.root, {
    write: true,
  }).ok;
}

/** Drops the marked block and leaves every other rule untouched. */
export function removeMergeDriver(board: Board): boolean {
  const p = join(board.root, ".gitattributes");
  if (!existsSync(p)) return false;
  const text = readFileSync(p, "utf8");
  const body = stripBlock(text);
  if (body === text.replace(/\s*$/, "")) return false;
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
