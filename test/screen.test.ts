import { describe, expect, test } from "bun:test";
import { clip, decodeKeys, pad, visLen } from "../src/tui/screen.js";

const ESC = "\u001b";
const RED = `${ESC}[31m`;
const OFF = `${ESC}[39m`;

describe("visible width", () => {
  test("colour codes occupy no cells", () => {
    expect(visLen(`${RED}abc${OFF}`)).toBe(3);
    expect(visLen("abc")).toBe(3);
  });

  test("clip preserves colour codes while shortening", () => {
    const out = clip(`${RED}abcdefghij${OFF}`, 5);
    expect(visLen(out)).toBeLessThanOrEqual(5);
    expect(out).toContain(RED);
  });

  test("clip leaves short strings alone", () => {
    expect(clip("abc", 10)).toBe("abc");
  });

  test("pad fills to the exact visible width", () => {
    expect(visLen(pad(`${RED}ab${OFF}`, 8))).toBe(8);
    expect(visLen(pad("", 4))).toBe(4);
  });

  test("pad never overflows an already-long string", () => {
    expect(visLen(pad("abcdefghij", 4))).toBeLessThanOrEqual(4);
  });
});

describe("key decoding", () => {
  test("plain characters carry their text", () => {
    const keys = decodeKeys("ab");
    expect(keys.map((k) => k.name)).toEqual(["a", "b"]);
    expect(keys.map((k) => k.ch).join("")).toBe("ab");
  });

  test("arrow keys decode to names, not escape soup", () => {
    expect(decodeKeys(`${ESC}[A`).map((k) => k.name)).toEqual(["up"]);
    expect(decodeKeys(`${ESC}[B`).map((k) => k.name)).toEqual(["down"]);
    expect(decodeKeys(`${ESC}OD`).map((k) => k.name)).toEqual(["left"]);
  });

  test("a lone escape is the escape key", () => {
    expect(decodeKeys(ESC).map((k) => k.name)).toEqual(["escape"]);
  });

  test("an unknown control sequence is swallowed whole", () => {
    // Otherwise a mouse report or bracketed paste marker lands in a text prompt.
    expect(decodeKeys(`${ESC}[200~x`).map((k) => k.name)).toEqual(["x"]);
    expect(decodeKeys(`${ESC}[?1004h`).map((k) => k.name)).toEqual([]);
  });

  test("enter, tab and backspace are named", () => {
    expect(decodeKeys("\r").map((k) => k.name)).toEqual(["enter"]);
    expect(decodeKeys("\n").map((k) => k.name)).toEqual(["enter"]);
    expect(decodeKeys("\t").map((k) => k.name)).toEqual(["tab"]);
    expect(decodeKeys("\u007f").map((k) => k.name)).toEqual(["backspace"]);
  });

  test("ctrl combinations are flagged", () => {
    const [c] = decodeKeys("\u0003");
    expect(c?.name).toBe("c");
    expect(c?.ctrl).toBe(true);
  });

  test("a pasted chunk decodes to every character", () => {
    const keys = decodeKeys("hello world");
    expect(keys.filter((k) => k.ch).length).toBe(11);
  });

  test("a chunk mixing text and arrows keeps order", () => {
    expect(decodeKeys(`a${ESC}[Ab`).map((k) => k.name)).toEqual(["a", "up", "b"]);
  });
});
