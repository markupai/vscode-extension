import { describe, expect, it } from "vitest";
import { markdownPassthrough } from "../../src/converters/markdownPassthrough.js";

describe("markdownPassthrough", () => {
  it("returns the input unchanged with a trivial offset map", () => {
    const c = markdownPassthrough("hello");
    expect(c.markdown).toBe("hello");
    expect(c.originalText).toBe("hello");
    expect(c.contentProfile).toBe("markdown");
    expect(c.offsetMap.pairs).toEqual([
      { md: 0, src: 0 },
      { md: 5, src: 5 },
    ]);
  });

  it("handles empty input", () => {
    const c = markdownPassthrough("");
    expect(c.markdown).toBe("");
    expect(c.offsetMap.pairs).toEqual([
      { md: 0, src: 0 },
      { md: 0, src: 0 },
    ]);
  });
});
