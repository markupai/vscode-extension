import { htmlToMarkdown } from "./htmlToMarkdown.js";
import type { ConvertedContent } from "../types.js";

/**
 * DITA → Markdown. We re-use the HTML converter: DITA's prose tags
 * (`<p>`, `<section>`, `<title>`, `<ul>`, `<li>`, `<codeblock>`, …)
 * map reasonably to HTML once renamed, which gives us offset tracking
 * for free. Downstream agents (other than style_agent) should NOT see
 * raw DITA — use this converter for them, per the product spec.
 *
 * style_agent sees the raw DITA text via `dita` content profile instead.
 */
export function ditaToMarkdown(dita: string): ConvertedContent {
  // `[^>]*>` is a linear, ReDoS-safe pattern (character class excludes `>`).
  // It matches either `<tag>` or `<tag attr=…>` in the same single pass.
  const pseudo = dita
    .replaceAll(/<title[^>]*>/g, "<h1>")
    .replaceAll("</title>", "</h1>")
    .replaceAll(/<section[^>]*>/g, "<section>")
    .replaceAll("</section>", "</section>")
    .replaceAll(/<codeblock[^>]*>/g, "<pre><code>")
    .replaceAll("</codeblock>", "</code></pre>")
    .replaceAll(/<codeph[^>]*>/g, "<code>")
    .replaceAll("</codeph>", "</code>")
    .replaceAll(/<ph[^>]*>/g, "")
    .replaceAll("</ph>", "")
    .replaceAll(/<b[^>]*>/g, "<strong>")
    .replaceAll("</b>", "</strong>")
    .replaceAll(/<i[^>]*>/g, "<em>")
    .replaceAll("</i>", "</em>")
    .replaceAll(/<note[^>]*>/g, "<blockquote>")
    .replaceAll("</note>", "</blockquote>");

  const converted = htmlToMarkdown(pseudo);
  return {
    markdown: converted.markdown,
    originalText: dita,
    offsetMap: converted.offsetMap,
    contentProfile: "markdown",
  };
}

/** Raw DITA pass-through for style_agent, which wants XML text as-is. */
export function ditaPassthrough(dita: string): ConvertedContent {
  return {
    markdown: dita,
    originalText: dita,
    offsetMap: {
      pairs: [
        { md: 0, src: 0 },
        { md: dita.length, src: dita.length },
      ],
    },
    contentProfile: "dita",
  };
}
