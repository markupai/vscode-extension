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
    .replace(/<title(\s[^>]*)?>/g, "<h1>")
    .replace(/<\/title>/g, "</h1>")
    .replace(/<section(\s[^>]*)?>/g, "<section>")
    .replace(/<\/section>/g, "</section>")
    .replace(/<codeblock(\s[^>]*)?>/g, "<pre><code>")
    .replace(/<\/codeblock>/g, "</code></pre>")
    .replace(/<codeph(\s[^>]*)?>/g, "<code>")
    .replace(/<\/codeph>/g, "</code>")
    .replace(/<ph(\s[^>]*)?>/g, "")
    .replace(/<\/ph>/g, "")
    .replace(/<b(\s[^>]*)?>/g, "<strong>")
    .replace(/<\/b>/g, "</strong>")
    .replace(/<i(\s[^>]*)?>/g, "<em>")
    .replace(/<\/i>/g, "</em>")
    .replace(/<note(\s[^>]*)?>/g, "<blockquote>")
    .replace(/<\/note>/g, "</blockquote>");

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
