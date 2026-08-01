import { afterAll, describe, expect, test } from "bun:test";
import { appendFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { log as logCmd } from "../src/commands/log.js";
import { logPath } from "../src/lib/board.js";
import { createTask } from "../src/lib/task.js";
import {
  appendLog,
  openQuestionEntries,
  parseInput,
  readLog,
  renderEntry,
  supersededIds,
  validate,
} from "../src/lib/log.js";
import { cleanup, tempBoard } from "./helpers.js";

afterAll(cleanup);

describe("parseInput", () => {
  test("reads the kind off the prefix", () => {
    expect(parseInput("decided: use X").kind).toBe("decided");
    expect(parseInput("dead end: tried Y").kind).toBe("dead-end");
    expect(parseInput("dead-end: tried Y").kind).toBe("dead-end");
    expect(parseInput("Outcome: shipped").kind).toBe("outcome");
    expect(parseInput("question: why?").kind).toBe("question");
  });

  test("defaults to note and strips the prefix", () => {
    const p = parseInput("just a fact");
    expect(p.kind).toBe("note");
    expect(p.text).toBe("just a fact");
    expect(parseInput("note: a fact").text).toBe("a fact");
  });

  test("parses a supersedes preamble", () => {
    const p = parseInput("supersedes l-abc123: the new call");
    expect(p.supersedes).toBe("l-abc123");
    expect(p.text).toBe("the new call");
    expect(p.kind).toBe("decided");
  });
});

describe("validate — mechanism, not verdict", () => {
  test("refuses a bare verdict", () => {
    const r = validate("decided", "use redis");
    expect(r.ok).toBe(false);
    expect(r.hint).toContain("mechanism");
  });

  test("accepts a because-clause", () => {
    expect(validate("decided", "use redis because the queue needs O(1) pops").ok).toBe(true);
    expect(validate("dead-end", "tried X since it deadlocks on write").ok).toBe(true);
  });

  test("accepts explicit unknown with evidence — honest vagueness is first class", () => {
    expect(validate("dead-end", "fails under load", "unknown", "panic: nil map").ok).toBe(true);
    expect(validate("dead-end", "fails under load", undefined, "panic: nil map").ok).toBe(true);
  });

  test("does not police notes and outcomes", () => {
    expect(validate("note", "a plain fact").ok).toBe(true);
    expect(validate("outcome", "shipped it").ok).toBe(true);
  });

  test("refuses empty text of any kind", () => {
    expect(validate("note", "   ").ok).toBe(false);
  });
});

describe("log file", () => {
  test("a malformed line is skipped, never fatal", () => {
    const board = tempBoard();
    appendLog(board, "t-1", { author: "test", kind: "note", text: "first" });
    const p = logPath(board, "t-1");
    mkdirSync(dirname(p), { recursive: true });
    appendFileSync(p, "this is not json\n{ broken\n\n");
    appendLog(board, "t-1", { author: "test", kind: "note", text: "second" });

    const entries = readLog(board, "t-1");
    expect(entries.map((e) => e.text)).toEqual(["first", "second"]);
  });

  test("entries come back in timestamp order", () => {
    const board = tempBoard();
    for (const t of ["a", "b", "c"]) appendLog(board, "t-1", { author: "x", kind: "note", text: t });
    const entries = readLog(board, "t-1");
    expect(entries.map((e) => e.ts)).toEqual([...entries.map((e) => e.ts)].sort());
  });

  test("a question is answered by a later entry pointing back at it", () => {
    const board = tempBoard();
    const q1 = appendLog(board, "t-1", { author: "x", kind: "question", text: "rotate?" });
    const q2 = appendLog(board, "t-1", { author: "x", kind: "question", text: "still open?" });
    appendLog(board, "t-1", { author: "x", kind: "answer", text: "yes", supersedes: q1.id });

    const open = openQuestionEntries(readLog(board, "t-1"));
    expect(open.map((e) => e.id)).toEqual([q2.id]);
  });

  test("supersedes is collected from the superseding entry", () => {
    const board = tempBoard();
    const first = appendLog(board, "t-1", { author: "x", kind: "decided", text: "old" });
    appendLog(board, "t-1", { author: "x", kind: "decided", text: "new", supersedes: first.id });
    expect(supersededIds(readLog(board, "t-1")).has(first.id)).toBe(true);
  });

  test("a rendered line always carries date, author and id", () => {
    const board = tempBoard();
    const e = appendLog(board, "t-1", { author: "agent", kind: "dead-end", text: "nope" });
    const line = renderEntry(e, { task: true });
    expect(line).toContain("agent");
    expect(line).toContain("t-1");
    expect(line).toContain(e.id);
    expect(line).toContain("dead end");
  });
});

describe("the log command refuses ambiguous input", () => {
  /** Silences the usage output so a refusal test does not spam the run. */
  function quietly<T>(fn: () => T): T {
    const err = console.error;
    console.error = () => {};
    try {
      return fn();
    } finally {
      console.error = err;
    }
  }

  function inBoard<T>(fn: (board: ReturnType<typeof tempBoard>) => T): T {
    const board = tempBoard();
    const cwd = process.cwd();
    process.chdir(board.root);
    try {
      return fn(board);
    } finally {
      process.chdir(cwd);
    }
  }

  test("stray words after the id are refused, not folded into the message", () => {
    // An unquoted shell variable used to prepend its extra words to the text and
    // record it as a note. The log is append-only, so that corruption is forever.
    inBoard((board) => {
      const t = createTask(board, { title: "Crest art" });
      const code = quietly(() =>
        logCmd({ positional: [t.id, "stray", "words", "note: the real message"], flags: {} }),
      );
      expect(code).toBe(2);
      expect(readLog(board, t.id).length).toBe(0);
    });
  });

  test("a single quoted message is still accepted", () => {
    inBoard((board) => {
      const t = createTask(board, { title: "Crest art" });
      const code = quietly(() =>
        logCmd({ positional: [t.id, "dead end: the bulldog read as a bear because of the muzzle"], flags: {} }),
      );
      expect(code).toBe(0);
      expect(readLog(board, t.id).length).toBe(1);
    });
  });

  test("a bare id with no message is refused", () => {
    inBoard((board) => {
      const t = createTask(board, { title: "Crest art" });
      const code = quietly(() => logCmd({ positional: [t.id], flags: {} }));
      expect(code).toBe(2);
      expect(readLog(board, t.id).length).toBe(0);
    });
  });
});
