import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { migrate } from "../src/commands/migrate.js";
import { parseArgs } from "../src/lib/args.js";
import {
  type Board,
  BoardError,
  hasLegacyLayout,
  listTaskIds,
  locate,
  logPath,
  requireBoard,
  taskPath,
} from "../src/lib/board.js";
import { appendLog, readLog } from "../src/lib/log.js";
import { createTask } from "../src/lib/task.js";
import { cleanup, tempBoard } from "./helpers.js";

afterAll(cleanup);

/** Writes a task where boards written before the nesting change kept them. */
function legacyTask(board: Board, id: string, title: string): void {
  const dir = join(board.dir, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "task.md"),
    `---\nid: ${id}\nstatus: open\ncreated: 2026-08-01\n---\n\n# ${title}\n`,
  );
  writeFileSync(
    join(dir, "log.ndjson"),
    `{"id":"l-old1","task":"${id}","ts":"2026-08-01T00:00:00.000Z","author":"agent","kind":"note","text":"a finding worth keeping"}\n`,
  );
}

function quietly<T>(fn: () => T): T {
  const [log, error] = [console.log, console.error];
  console.log = () => {};
  console.error = () => {};
  try {
    return fn();
  } finally {
    console.log = log;
    console.error = error;
  }
}

/** Commands resolve the board from cwd, so a command test has to stand in it. */
function inBoard<T>(board: Board, fn: () => T): T {
  const cwd = process.cwd();
  process.chdir(board.root);
  try {
    return fn();
  } finally {
    process.chdir(cwd);
  }
}

const run = (board: Board, ...argv: string[]) =>
  inBoard(board, () => quietly(() => migrate(parseArgs(argv))));

describe("layout", () => {
  test("a new task is written below .tasks/tasks/", () => {
    const board = tempBoard();
    const task = createTask(board, { title: "Nested" });
    expect(existsSync(join(board.dir, "tasks", task.id, "task.md"))).toBe(true);
    expect(existsSync(join(board.dir, task.id))).toBe(false);
  });

  test("path helpers stay pure joins so a closed task is still writable", () => {
    const board = tempBoard();
    const task = createTask(board, { title: "Closed later" });
    expect(taskPath(board, task.id)).toBe(join(board.dir, "tasks", task.id, "task.md"));
    expect(logPath(board, task.id)).toBe(join(board.dir, "tasks", task.id, "log.ndjson"));
  });

  test("a legacy board is refused rather than read", () => {
    const board = tempBoard();
    legacyTask(board, "t-legacy1", "Old shape");
    expect(hasLegacyLayout(board)).toBe(true);
    expect(() => requireBoard(board.root)).toThrow(BoardError);
    expect(() => requireBoard(board.root)).toThrow(/cairn migrate/);
  });

  test("a migrated board is accepted", () => {
    const board = tempBoard();
    createTask(board, { title: "Fine" });
    expect(hasLegacyLayout(board)).toBe(false);
    expect(() => requireBoard(board.root)).not.toThrow();
  });
});

describe("migrate", () => {
  test("moves legacy tasks and keeps their logs intact", () => {
    const board = tempBoard();
    legacyTask(board, "t-legacy1", "One");
    legacyTask(board, "t-legacy2", "Two");

    const code = run(board);
    expect(code).toBe(0);

    const after = locate(board.root);
    expect(listTaskIds(after).sort()).toEqual(["t-legacy1", "t-legacy2"]);
    expect(existsSync(join(board.dir, "t-legacy1"))).toBe(false);
    expect(readLog(after, "t-legacy1")[0]!.text).toBe("a finding worth keeping");
  });

  test("a migrated task still accepts an appended entry", () => {
    const board = tempBoard();
    legacyTask(board, "t-legacy1", "One");
    run(board);

    const after = locate(board.root);
    appendLog(after, "t-legacy1", { author: "agent", kind: "note", text: "supersedes l-old1: no" });
    expect(readLog(after, "t-legacy1")).toHaveLength(2);
  });

  test("a second run finds nothing to do", () => {
    const board = tempBoard();
    legacyTask(board, "t-legacy1", "One");
    run(board);
    expect(run(board)).toBe(0);
    expect(listTaskIds(locate(board.root))).toEqual(["t-legacy1"]);
  });

  test("--dry-run moves nothing", () => {
    const board = tempBoard();
    legacyTask(board, "t-legacy1", "One");
    expect(run(board, "--dry-run")).toBe(0);
    expect(existsSync(join(board.dir, "t-legacy1", "task.md"))).toBe(true);
    expect(listTaskIds(locate(board.root))).toEqual([]);
  });

  test("refuses when the same id exists in both layouts", () => {
    const board = tempBoard();
    legacyTask(board, "t-dupe", "Old copy");
    mkdirSync(join(board.dir, "tasks", "t-dupe"), { recursive: true });
    writeFileSync(join(board.dir, "tasks", "t-dupe", "task.md"), "---\nid: t-dupe\n---\n# New copy\n");

    expect(run(board)).toBe(1);
    expect(existsSync(join(board.dir, "t-dupe", "task.md"))).toBe(true);
    expect(readFileSync(join(board.dir, "tasks", "t-dupe", "task.md"), "utf8")).toContain(
      "New copy",
    );
  });

  test("inside a repo the move is staged as a rename", () => {
    const board = tempBoard();
    execFileSync("git", ["init", "-q"], { cwd: board.root });
    execFileSync("git", ["config", "user.email", "t@t.t"], { cwd: board.root });
    execFileSync("git", ["config", "user.name", "t"], { cwd: board.root });
    legacyTask(board, "t-tracked", "Tracked");
    execFileSync("git", ["add", "-A"], { cwd: board.root });
    execFileSync("git", ["commit", "-qm", "add task"], { cwd: board.root });

    run(board);

    const status = execFileSync("git", ["status", "--porcelain"], {
      cwd: board.root,
      encoding: "utf8",
    });
    expect(status).toMatch(/^R/m);
    expect(status).not.toMatch(/^\?\?/m);
  });
});
