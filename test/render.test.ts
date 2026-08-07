import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "../src/commands/render.js";
import { uninstall } from "../src/commands/uninstall.js";
import { type Board, locate, writeActive } from "../src/lib/board.js";
import { installMergeDriver } from "../src/lib/githooks.js";
import { appendLog } from "../src/lib/log.js";
import { DEAD_END_CAP, RENDER_FILE, renderBoard } from "../src/lib/render.js";
import { writeSection } from "../src/lib/sections.js";
import { createTask, writeTask } from "../src/lib/task.js";
import { cleanup, tempBoard } from "./helpers.js";

afterAll(cleanup);

function gitBoard(): Board {
  const board = tempBoard();
  execFileSync("git", ["init", "-q"], { cwd: board.root });
  return locate(board.root);
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

function inBoard<T>(board: Board, fn: () => T): T {
  const cwd = process.cwd();
  process.chdir(board.root);
  try {
    return fn();
  } finally {
    process.chdir(cwd);
  }
}

describe("renderBoard", () => {
  test("an empty board renders a page instead of failing", () => {
    const page = renderBoard(tempBoard());
    expect(page).toContain("# Task board");
    expect(page).toContain("No tasks yet");
  });

  test("the same board renders byte-identical every time", () => {
    // The page is committed, so anything clock- or environment-derived in it
    // would make every clone disagree and every regeneration a diff.
    const board = tempBoard();
    createTask(board, { title: "First" });
    createTask(board, { title: "Second" });

    expect(renderBoard(board)).toBe(renderBoard(board));
    expect(renderBoard(board)).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:/);
  });

  test("a task id links to a path the git host can resolve from the page", () => {
    const board = tempBoard();
    const task = createTask(board, { title: "Linkable" });
    // Relative to `.tasks/`, because that is where the page lives — so the link
    // descends into `tasks/`, which is where the task itself lives.
    expect(renderBoard(board)).toContain(`(tasks/${task.id}/task.md)`);
  });

  test("a pipe in a title stays inside its table cell", () => {
    const board = tempBoard();
    createTask(board, { title: "Parse a | b without breaking" });
    const row = renderBoard(board)
      .split("\n")
      .find((l) => l.includes("Parse a"))!;
    expect(row).toContain("a \\| b");
    // Six unescaped pipes is one row of five cells; the seventh is the escaped one.
    expect(row.split(/(?<!\\)\|/).length - 1).toBe(6);
  });

  test("dead ends carry their mechanism onto the page", () => {
    const board = tempBoard();
    const task = createTask(board, { title: "Ship it" });
    appendLog(board, task.id, {
      author: "agent",
      kind: "dead-end",
      text: "verification in middleware",
      mechanism: "middleware runs after the response flushes",
    });

    const page = renderBoard(board);
    expect(page).toContain("verification in middleware");
    expect(page).toContain("mechanism: middleware runs after the response flushes");
  });

  test("a superseded dead end drops off the page", () => {
    // Overturning is the only way to correct an append-only log. A page that
    // keeps showing the overturned entry keeps the correction from landing.
    const board = tempBoard();
    const task = createTask(board, { title: "Ship it" });
    const dead = appendLog(board, task.id, {
      author: "agent",
      kind: "dead-end",
      text: "the old wrong thing",
      mechanism: "measured badly",
    });
    appendLog(board, task.id, {
      author: "agent",
      kind: "decided",
      text: "it works after all because the benchmark was wrong",
      supersedes: dead.id,
    });

    expect(renderBoard(board)).not.toContain("the old wrong thing");
  });

  test("an open question is on the page and an answered one is not", () => {
    const board = tempBoard();
    const task = createTask(board, { title: "Needs a human" });
    const asked = appendLog(board, task.id, {
      author: "agent",
      kind: "question",
      text: "which region do we default to",
    });
    appendLog(board, task.id, { author: "agent", kind: "question", text: "still undecided" });
    appendLog(board, task.id, {
      author: "human",
      kind: "answer",
      text: "us-east-1",
      supersedes: asked.id,
    });

    const page = renderBoard(board);
    expect(page).toContain("Open questions (1)");
    expect(page).toContain("still undecided");
    expect(page).not.toContain("which region do we default to");
  });

  test("a truncated section says so, and says how to reach the rest", () => {
    const board = tempBoard();
    const task = createTask(board, { title: "Long history" });
    for (let i = 0; i < DEAD_END_CAP + 3; i++) {
      appendLog(board, task.id, {
        author: "agent",
        kind: "dead-end",
        text: `attempt ${i}`,
        mechanism: "measured",
      });
    }

    const page = renderBoard(board);
    expect(page).toContain(`Dead ends (${DEAD_END_CAP + 3})`);
    expect(page).toContain("3 older dead ends are not shown");
    expect(page).toContain("cairn search");
  });

  test("a closed task keeps its outcome on the page", () => {
    const board = tempBoard();
    const task = createTask(board, { title: "Done thing" });
    task.status = "done";
    task.closed = "2026-01-01";
    task.body = writeSection(task.body, "outcome", "the thing that shipped");
    writeTask(task);

    const page = renderBoard(board);
    expect(page).toContain("Closed (1)");
    expect(page).toContain("the thing that shipped");
  });

  test("the active task is named at the top", () => {
    const board = tempBoard();
    const task = createTask(board, { title: "In flight", status: "doing" });
    writeActive(board, task.id);
    expect(renderBoard(board)).toContain(`**Active:** [\`${task.id}\`]`);
  });
});

describe("cairn render", () => {
  test("writes the page where a git host renders it", () => {
    const board = tempBoard();
    createTask(board, { title: "Anything" });
    inBoard(board, () => quietly(() => render({ positional: [], flags: {} })));
    expect(existsSync(join(board.dir, RENDER_FILE))).toBe(true);
  });

  test("--check fails on a stale page and passes on a fresh one", () => {
    const board = tempBoard();
    createTask(board, { title: "Anything" });

    const missing = inBoard(board, () =>
      quietly(() => render({ positional: [], flags: { check: true } })),
    );
    expect(missing).toBe(1);

    inBoard(board, () => quietly(() => render({ positional: [], flags: {} })));
    expect(inBoard(board, () => quietly(() => render({ positional: [], flags: { check: true } })))).toBe(0);

    createTask(board, { title: "Something new since" });
    expect(inBoard(board, () => quietly(() => render({ positional: [], flags: { check: true } })))).toBe(1);
  });

  test("--check never writes the file it is checking", () => {
    const board = tempBoard();
    createTask(board, { title: "Anything" });
    inBoard(board, () => quietly(() => render({ positional: [], flags: { check: true } })));
    expect(existsSync(join(board.dir, RENDER_FILE))).toBe(false);
  });

  test("--out writes the same bytes somewhere else, for the merge driver", () => {
    // The driver is handed a temp path, so content must not depend on where it
    // is written — the links in it are relative to `.tasks/` either way.
    const board = tempBoard();
    createTask(board, { title: "Anything" });
    const elsewhere = join(board.root, "scratch.md");
    inBoard(board, () => quietly(() => render({ positional: [], flags: { out: "scratch.md" } })));
    expect(readFileSync(elsewhere, "utf8")).toBe(renderBoard(board));
  });
});

describe(".gitattributes versioning", () => {
  test("an install carrying the v1 marker picks up rules added since", () => {
    // The marker used to be an unconditional early return, so a repo that had
    // already been initialised could never receive a new rule.
    const board = tempBoard();
    const p = join(board.root, ".gitattributes");
    writeFileSync(p, "# cairns:attributes\n.tasks/**/log.ndjson merge=union\n");

    expect(installMergeDriver(board)).toBe("updated");
    const text = readFileSync(p, "utf8");
    expect(text).toContain("merge=cairns-board");
    expect(text.split("# cairns:attributes").length - 1).toBe(1);
    expect(text.split("merge=union").length - 1).toBe(1);
  });

  test("a second install is a no-op", () => {
    const board = tempBoard();
    installMergeDriver(board);
    expect(installMergeDriver(board)).toBe("unchanged");
  });
});

describe("cairn uninstall", () => {
  test("takes the generated page with it", () => {
    // It is derived and committed, so leaving it behind serves a board page
    // that nothing regenerates.
    const board = gitBoard();
    createTask(board, { title: "Anything" });
    inBoard(board, () => quietly(() => render({ positional: [], flags: {} })));
    expect(existsSync(join(board.dir, RENDER_FILE))).toBe(true);

    inBoard(board, () => quietly(() => uninstall({ positional: [], flags: {} })));
    expect(existsSync(join(board.dir, RENDER_FILE))).toBe(false);
    expect(existsSync(join(board.root, ".gitattributes"))).toBe(false);
  });
});
