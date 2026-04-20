import { describe, expect, it } from "vitest";
import { htmlToMarkdown } from "../../src/converters/htmlToMarkdown.js";

describe("htmlToMarkdown", () => {
  it("converts headings and paragraphs", () => {
    const { markdown } = htmlToMarkdown("<h1>Hello</h1><p>world</p>");
    expect(markdown).toContain("# Hello");
    expect(markdown).toContain("world");
  });

  it("strips scripts, styles, and comments", () => {
    const { markdown } = htmlToMarkdown(
      "<style>body{}</style><!--hi--><script>alert(1)</script><p>ok</p>",
    );
    expect(markdown).not.toContain("alert");
    expect(markdown).not.toContain("body{}");
    expect(markdown).toContain("ok");
  });

  it("decodes html entities", () => {
    const { markdown } = htmlToMarkdown("<p>a &amp; b &lt;c&gt; d &#39;e&#39;</p>");
    expect(markdown).toContain("a & b <c> d 'e'");
  });

  it("renders lists", () => {
    const { markdown } = htmlToMarkdown("<ul><li>one</li><li>two</li></ul>");
    expect(markdown).toContain("- one");
    expect(markdown).toContain("- two");
  });

  it("numbers ordered lists", () => {
    const { markdown } = htmlToMarkdown("<ol><li>one</li><li>two</li></ol>");
    expect(markdown).toMatch(/1\. one/);
    expect(markdown).toMatch(/2\. two/);
  });

  it("renders emphasis and strong", () => {
    const { markdown } = htmlToMarkdown("<p><strong>bold</strong> and <em>italic</em></p>");
    expect(markdown).toContain("**bold**");
    expect(markdown).toContain("*italic*");
  });

  it("renders br/hr", () => {
    const { markdown } = htmlToMarkdown("<p>a<br>b</p><hr><p>c</p>");
    expect(markdown).toContain("a\nb");
    expect(markdown).toContain("---");
  });

  it("produces an offset map whose first/last pairs match endpoints", () => {
    const html = "<p>hello world</p>";
    const { offsetMap } = htmlToMarkdown(html);
    expect(offsetMap.pairs[0]).toEqual({ md: 0, src: 0 });
    const last = offsetMap.pairs[offsetMap.pairs.length - 1];
    expect(last.src).toBe(html.length);
  });
});
