import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseIntOption } from "../src/util.js";
import { setupHarness, expectExit, type TestHarness } from "./helpers.js";

let harness: TestHarness;

beforeEach(() => {
  harness = setupHarness();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("parseIntOption", () => {
  it("T16: non-integer value → die with [--name requires an integer, got: X]", async () => {
    const parser = parseIntOption("limit");

    const code = await expectExit(() => parser("abc"));

    expect(code).toBe(1);
    expect(harness.stderr()).toBe("--limit requires an integer, got: abc");
  });

  it("accepts a valid positive integer", () => {
    expect(parseIntOption("limit")("42")).toBe(42);
  });

  it("accepts a negative integer", () => {
    expect(parseIntOption("offset")("-7")).toBe(-7);
  });

  it("rejects floats", async () => {
    const code = await expectExit(() => parseIntOption("limit")("3.14"));
    expect(code).toBe(1);
    expect(harness.stderr()).toBe("--limit requires an integer, got: 3.14");
  });
});
