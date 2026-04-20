import { ditaPassthrough, ditaToMarkdown } from "./ditaToMarkdown.js";
import { htmlToMarkdown } from "./htmlToMarkdown.js";
import { markdownPassthrough } from "./markdownPassthrough.js";
import type { ConvertedContent } from "../types.js";

export type DocumentKind = "markdown" | "html" | "dita" | "text";

export function detectKind(fileName: string): DocumentKind {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "markdown";
  if (lower.endsWith(".html") || lower.endsWith(".htm") || lower.endsWith(".xhtml")) return "html";
  if (lower.endsWith(".dita") || lower.endsWith(".ditamap")) return "dita";
  return "text";
}

/**
 * Convert a source document to the payload shape each agent expects.
 *
 * Per the product spec:
 *   - style_agent sees the raw source when the source is DITA (`dita` profile),
 *     and sees markdown otherwise.
 *   - All other agents always receive markdown.
 *
 * Call this once with `forStyleAgent: true` and once with `forStyleAgent: false`
 * if you need both; the scanner handles that split.
 */
export function convertForAgents(
  text: string,
  fileName: string,
  forStyleAgent: boolean,
): ConvertedContent {
  const kind = detectKind(fileName);
  if (kind === "dita" && forStyleAgent) return ditaPassthrough(text);
  if (kind === "html") return htmlToMarkdown(text);
  if (kind === "dita") return ditaToMarkdown(text);
  return markdownPassthrough(text);
}

export { htmlToMarkdown, ditaToMarkdown, ditaPassthrough, markdownPassthrough };
