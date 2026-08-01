import { describe, expect, test } from "bun:test";
import { isLogId, isTaskId, newLogId, newTaskId } from "../src/lib/ids.js";

describe("ids", () => {
  test("a burst of ids in the same second does not collide", () => {
    // The failure this exists to prevent: two agents allocating the same
    // ordinal, then git merging both files over each other.
    const ids = new Set<string>();
    for (let i = 0; i < 20000; i++) ids.add(newTaskId());
    expect(ids.size).toBe(20000);
  });

  test("ids sort chronologically as plain strings", () => {
    const early = newTaskId();
    const later = newTaskId();
    // Same-second ids differ only in the random tail, so compare the time part.
    expect(early.slice(0, 8) <= later.slice(0, 8)).toBe(true);
  });

  test("minted ids validate", () => {
    expect(isTaskId(newTaskId())).toBe(true);
    expect(isLogId(newLogId())).toBe(true);
  });

  test("hand-written ids stay valid", () => {
    expect(isTaskId("t-042")).toBe(true);
    expect(isTaskId("t-auth")).toBe(true);
  });

  test("rejects ids of the wrong kind", () => {
    expect(isTaskId("l-2dq51jfb8z")).toBe(false);
    expect(isTaskId("nope")).toBe(false);
    expect(isTaskId("")).toBe(false);
  });
});
