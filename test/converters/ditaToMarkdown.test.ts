import { describe, expect, it } from "vitest";
import { ditaPassthrough, ditaToMarkdown } from "../../src/converters/ditaToMarkdown.js";

describe("ditaToMarkdown", () => {
  it("renames DITA prose tags and converts to markdown", () => {
    const dita = "<title>Intro</title><p>hello <b>world</b></p>";
    const { markdown, contentProfile } = ditaToMarkdown(dita);
    expect(markdown).toContain("# Intro");
    expect(markdown).toContain("**world**");
    expect(contentProfile).toBe("markdown");
  });

  it("converts codeblock to fenced markdown", () => {
    const dita = "<codeblock>let x = 1;</codeblock>";
    const { markdown } = ditaToMarkdown(dita);
    expect(markdown).toContain("```");
    expect(markdown).toContain("let x = 1;");
  });

  it("handles note as blockquote", () => {
    const { markdown } = ditaToMarkdown("<note>be careful</note>");
    expect(markdown).toMatch(/>\s*be careful/);
  });
});

describe("ditaPassthrough", () => {
  it("returns the raw DITA text with a dita content profile", () => {
    const dita = "<title>t</title>";
    const c = ditaPassthrough(dita);
    expect(c.markdown).toBe(dita);
    expect(c.originalText).toBe(dita);
    expect(c.contentProfile).toBe("dita");
    expect(c.offsetMap.pairs[0]).toEqual({ md: 0, src: 0 });
    expect(c.offsetMap.pairs[1]).toEqual({ md: dita.length, src: dita.length });
  });
});
