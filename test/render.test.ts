import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { COMMANDS, MUTATES, main } from "../src/cli.js";
import { render } from "../src/commands/render.js";
import { uninstall } from "../src/commands/uninstall.js";
import { type Board, locate, writeActive } from "../src/lib/board.js";
import { installMergeDriver } from "../src/lib/githooks.js";
import { appendLog } from "../src/lib/log.js";
import { DEAD_END_CAP, RENDER_FILE, pagePath, renderBoard } from "../src/lib/render.js";
import { writeSection } from "../src/lib/sections.js";
import { createTask, listTasks, writeTask } from "../src/lib/task.js";
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
    const lines = renderBoard(board).split("\n");
    const header = lines.find((l) => l.startsWith("| Task |"))!;
    const row = lines.find((l) => l.includes("Parse a"))!;

    expect(row).toContain("a \\| b");
    // Counting cells rather than a fixed number, because which columns render
    // now depends on what the rows hold. The invariant is that the escaped pipe
    // did not split the row into one more cell than the header has.
    const cells = (l: string) => l.split(/(?<!\\)\|/).length - 1;
    expect(cells(row)).toBe(cells(header));
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

describe("the page refreshes when the board changes, not when git does", () => {
  /** What is on disk, against what the board says it should be. */
  function pageIsFresh(board: Board): boolean {
    const target = pagePath(board);
    return existsSync(target) && readFileSync(target, "utf8") === renderBoard(board);
  }

  // `inBoard` restores the cwd synchronously, which would land after an awaited
  // `main` and leave the post-command refresh rendering the wrong directory.
  async function run(board: Board, ...argv: string[]): Promise<number> {
    const cwd = process.cwd();
    process.chdir(board.root);
    const [log, error] = [console.log, console.error];
    console.log = () => {};
    console.error = () => {};
    try {
      return await main(argv);
    } finally {
      console.log = log;
      console.error = error;
      process.chdir(cwd);
    }
  }

  test("a whole session leaves the page fresh after every mutating command", async () => {
    // The regression this exists for: the only refresh was wired to `post-merge`,
    // so a repo that never merges rendered once and then drifted. Every command
    // below changes `.tasks/` without going anywhere near git.
    const board = gitBoard();
    expect(await run(board, "init")).toBe(0);

    expect(await run(board, "add", "First task")).toBe(0);
    expect(pageIsFresh(board)).toBe(true);

    const id = listTasks(board)[0]!.id;

    for (const argv of [
      ["start", id],
      ["log", id, "note: something true"],
      ["ask", id, "which way?"],
      ["stop"],
      ["done", id, "--outcome", "shipped it"],
    ]) {
      expect(await run(board, ...argv)).toBe(0);
      expect(pageIsFresh(board)).toBe(true);
    }
  });

  test("the page tracks the count, not just its own existence", async () => {
    const board = gitBoard();
    await run(board, "init");
    await run(board, "add", "One");
    expect(readFileSync(pagePath(board), "utf8")).toContain("## Open (1)");
    await run(board, "add", "Two");
    // The stale page in the field claimed 34 open tasks against 51 on disk;
    // existence alone would have passed that board.
    expect(readFileSync(pagePath(board), "utf8")).toContain("## Open (2)");
  });

  test("every name in MUTATES is a real command", () => {
    // A typo here fails open — the page silently stops refreshing for that
    // command and nothing else notices, which is the whole bug class.
    for (const name of MUTATES) expect(Object.keys(COMMANDS)).toContain(name);
  });

  test("a refused command does not render on its way out", async () => {
    const board = gitBoard();
    await run(board, "init");
    await run(board, "add", "Only task");
    const before = readFileSync(pagePath(board), "utf8");

    // `done` without an outcome is refused, so nothing about the board changed.
    expect(await run(board, "done", listTasks(board)[0]!.id)).toBe(1);
    expect(readFileSync(pagePath(board), "utf8")).toBe(before);
  });

  test("a page that cannot be written does not fail the command that changed the board", async () => {
    const board = gitBoard();
    await run(board, "init");
    // A directory where the page belongs: the write throws, the mutation stands.
    rmSync(pagePath(board), { force: true });
    mkdirSync(pagePath(board), { recursive: true });

    expect(await run(board, "add", "Recorded even though the page cannot be")).toBe(0);
    expect(listTasks(board)).toHaveLength(1);
  });
});

describe("the open table is scannable at 50 rows", () => {
  test("rows run newest first, because ascending ids buried today's work", () => {
    const board = tempBoard();
    const a = createTask(board, { title: "One" });
    const b = createTask(board, { title: "Two" });

    // Keyed on id order rather than creation order on purpose. `mint` encodes
    // whole seconds, so two tasks created inside the same second tie on the
    // time prefix and are separated only by their random tail — creation order
    // is not recoverable from the id at sub-second resolution, and asserting it
    // makes this test pass or fail on a coin flip.
    const [older, newer] = [a.id, b.id].sort();
    const page = renderBoard(board);
    expect(page.indexOf(newer!)).toBeLessThan(page.indexOf(older!));
  });

  test("a column every row would leave blank is not rendered", () => {
    const board = tempBoard();
    createTask(board, { title: "No findings on this one" });
    const header = renderBoard(board)
      .split("\n")
      .find((l) => l.startsWith("| Task |"))!;

    expect(header).toContain("Created");
    expect(header).toContain("Title");
    for (const dropped of ["Dead ends", "Questions", "Log"]) {
      expect(header).not.toContain(dropped);
    }
  });

  test("a column one row actually uses comes back", () => {
    const board = tempBoard();
    const task = createTask(board, { title: "This one has a finding" });
    appendLog(board, task.id, { author: "t", kind: "dead-end", text: "x failed because y" });
    const header = renderBoard(board)
      .split("\n")
      .find((l) => l.startsWith("| Task |"))!;
    expect(header).toContain("Dead ends");
    expect(header).toContain("Log");
    expect(header).not.toContain("Questions");
  });

  test("empty columns are judged per table, not per board", () => {
    // An In progress row with no findings should not carry columns it leaves
    // blank just because some unrelated open task fills them.
    const board = tempBoard();
    const busy = createTask(board, { title: "Open task carrying findings" });
    appendLog(board, busy.id, { author: "t", kind: "dead-end", text: "x failed because y" });
    const quiet = createTask(board, { title: "Started, nothing recorded yet" });
    quiet.status = "doing";
    writeTask(quiet);

    const lines = renderBoard(board).split("\n");
    const headerUnder = (section: string) => {
      const at = lines.findIndex((l) => l.startsWith(`## ${section}`));
      return lines.slice(at).find((l) => l.startsWith("| Task |"))!;
    };
    expect(headerUnder("In progress")).not.toContain("Dead ends");
    expect(headerUnder("Open")).toContain("Dead ends");
  });

  test("the created date on the page is the one in the file, never today", () => {
    // Bucketing by age would read better and would make the page a function of
    // the clock: the same board would render different bytes tomorrow and
    // `--check` would call a correct page stale every midnight.
    const board = tempBoard();
    const task = createTask(board, { title: "Opened long ago" });
    task.created = "2019-04-01";
    writeTask(task);

    const page = renderBoard(board);
    expect(page).toContain("2019-04-01");
    expect(page).not.toContain(new Date().toISOString().slice(0, 10));
  });
});
