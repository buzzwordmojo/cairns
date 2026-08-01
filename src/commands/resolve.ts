import type { Board } from "../lib/board.js";
import { readActive } from "../lib/board.js";
import { type Task, readTask, resolveTask } from "../lib/task.js";
import { bold, dim, red } from "../lib/ui.js";

/**
 * Shared id resolution. Falls back to the active task when no id is given, so
 * `cairn log "note: …"` works mid-session without retyping an id.
 */
export function resolveOrExplain(board: Board, input: string | undefined): Task | null {
  if (!input) {
    const activeId = readActive(board);
    if (!activeId) {
      console.error(red("no task id given and no active task."));
      console.error(dim(`  set one with `) + bold("cairn start <id>"));
      return null;
    }
    const t = readTask(board, activeId);
    if (!t) {
      console.error(red(`active task ${activeId} no longer exists on disk.`));
      return null;
    }
    return t;
  }

  const found = resolveTask(board, input);
  if (found === null) {
    console.error(red(`no task matching "${input}".`));
    console.error(dim(`  list them with `) + bold("cairn list"));
    return null;
  }
  if ("ambiguous" in found) {
    console.error(red(`"${input}" matches ${found.ambiguous.length} tasks:`));
    for (const id of found.ambiguous) console.error(`  ${id}`);
    return null;
  }
  return found;
}
