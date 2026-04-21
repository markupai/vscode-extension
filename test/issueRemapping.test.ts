import { describe, expect, it } from "vitest";
import { issueId, remapIssue, remapOffset, withIds } from "../src/issueRemapping.js";
import type { Issue, OffsetMap } from "../src/types.js";

const simpleMap: OffsetMap = {
  pairs: [
    { md: 0, src: 0 },
    { md: 10, src: 20 },
    { md: 20, src: 40 },
  ],
};

describe("remapOffset", () => {
  it("clamps below-range offsets to the first pair", () => {
    expect(remapOffset(simpleMap, -5)).toBe(0);
  });

  it("clamps above-range offsets to the last pair", () => {
    expect(remapOffset(simpleMap, 999)).toBe(40);
  });

  it("interpolates within a segment preserving the md delta", () => {
    // md=5 is 5 past pair0 (md 0→10 covers src 0→20)
    expect(remapOffset(simpleMap, 5)).toBe(5);
  });

  it("returns exact pair positions for exact matches", () => {
    expect(remapOffset(simpleMap, 10)).toBe(20);
    expect(remapOffset(simpleMap, 20)).toBe(40);
  });

  it("handles an empty map as identity", () => {
    expect(remapOffset({ pairs: [] }, 7)).toBe(7);
  });
});

describe("remapIssue", () => {
  it("maps start and end offsets via the map", () => {
    const issue: Issue = {
      agent: "x",
      confidence: 0.5,
      severity: "low",
      explanation: "e",
      position: { start: 10, end: 20 },
    };
    const mapped = remapIssue(issue, simpleMap);
    expect(mapped.position.start).toBe(20);
    expect(mapped.position.end).toBe(40);
  });
});

describe("issueId", () => {
  it("produces the same id for identical issues", () => {
    const a: Issue = {
      agent: "x",
      confidence: 0.5,
      severity: "low",
      explanation: "e",
      position: { start: 1, end: 2 },
    };
    const b = { ...a };
    expect(issueId(a)).toBe(issueId(b));
  });

  it("produces different ids when explanation differs", () => {
    const a: Issue = {
      agent: "x",
      confidence: 0.5,
      severity: "low",
      explanation: "one",
      position: { start: 1, end: 2 },
    };
    const b: Issue = { ...a, explanation: "two" };
    expect(issueId(a)).not.toBe(issueId(b));
  });
});

describe("withIds", () => {
  it("attaches ids to every issue", () => {
    const issues: Issue[] = [
      {
        agent: "a",
        confidence: 1,
        severity: "high",
        explanation: "e",
        position: { start: 0, end: 3 },
      },
    ];
    const out = withIds(issues);
    expect(out).toHaveLength(1);
    expect(out[0].id).toMatch(/^a\|/);
  });
});
