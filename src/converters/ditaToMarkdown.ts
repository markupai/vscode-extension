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
  const pseudo = dita
    .replaceAll(/<title(\s[^>]*)?>/g, "<h1>")
    .replaceAll("</title>", "</h1>")
    .replaceAll(/<section(\s[^>]*)?>/g, "<section>")
    .replaceAll("</section>", "</section>")
    .replaceAll(/<codeblock(\s[^>]*)?>/g, "<pre><code>")
    .replaceAll("</codeblock>", "</code></pre>")
    .replaceAll(/<codeph(\s[^>]*)?>/g, "<code>")
    .replaceAll("</codeph>", "</code>")
    .replaceAll(/<ph(\s[^>]*)?>/g, "")
    .replaceAll("</ph>", "")
    .replaceAll(/<b(\s[^>]*)?>/g, "<strong>")
    .replaceAll("</b>", "</strong>")
    .replaceAll(/<i(\s[^>]*)?>/g, "<em>")
    .replaceAll("</i>", "</em>")
    .replaceAll(/<note(\s[^>]*)?>/g, "<blockquote>")
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
