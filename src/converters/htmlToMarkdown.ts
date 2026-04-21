import type { ConvertedContent, OffsetPair } from "../types.js";

/**
 * Minimal HTML → Markdown converter with source-offset tracking.
 *
 * Scope: headings, paragraphs, lists, blockquote, code, links, emphasis,
 * line breaks — enough for documentation-style HTML. The goal is not
 * perfect rendering but faithful text extraction with offset mapping,
 * so the agent sees readable prose and issue positions map back.
 *
 * Unsupported tags degrade to their text content. Scripts/styles are dropped.
 */
export function htmlToMarkdown(html: string): ConvertedContent {
  const clean = stripScriptsAndStyles(html);
  const tokens = tokenize(clean);
  const { markdown, pairs } = renderTokens(tokens);
  return {
    markdown,
    originalText: html,
    offsetMap: { pairs },
    contentProfile: "markdown",
  };
}

function stripScriptsAndStyles(html: string): string {
  let out = stripPaired(html, "<script", "</script>");
  out = stripPaired(out, "<style", "</style>");
  out = stripPaired(out, "<!--", "-->");
  return out;
}

/**
 * Remove every `<open…close>` block using indexOf scans — each byte is
 * visited at most twice, so this is explicitly O(n). A regex with
 * `[\s\S]*?` does the same thing but trips Sonar's ReDoS heuristics.
 */
function stripPaired(input: string, open: string, close: string): string {
  const lowered = input.toLowerCase();
  const openLower = open.toLowerCase();
  const closeLower = close.toLowerCase();
  let out = "";
  let i = 0;
  while (i < input.length) {
    const start = lowered.indexOf(openLower, i);
    if (start === -1) {
      out += input.slice(i);
      break;
    }
    out += input.slice(i, start);
    const end = lowered.indexOf(closeLower, start + openLower.length);
    if (end === -1) break;
    i = end + closeLower.length;
  }
  return out;
}

interface Token {
  kind: "tag" | "text";
  value: string;
  /** Byte offset in the source (pre-strip is close enough for offset mapping). */
  offset: number;
}

function tokenize(html: string): Token[] {
  const tokens: Token[] = [];
  const re = /<\/?[a-zA-Z][^>]*>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (m.index > last) {
      tokens.push({ kind: "text", value: html.slice(last, m.index), offset: last });
    }
    tokens.push({ kind: "tag", value: m[0], offset: m.index });
    last = m.index + m[0].length;
  }
  if (last < html.length) {
    tokens.push({ kind: "text", value: html.slice(last), offset: last });
  }
  return tokens;
}

interface RenderState {
  out: string;
  pairs: OffsetPair[];
  listDepth: number;
  /** Stack of "ul" | "ol" with counter. */
  lists: { kind: "ul" | "ol"; index: number }[];
  inPre: boolean;
}

function renderTokens(tokens: Token[]): { markdown: string; pairs: OffsetPair[] } {
  const state: RenderState = {
    out: "",
    pairs: [{ md: 0, src: 0 }],
    listDepth: 0,
    lists: [],
    inPre: false,
  };

  for (const tok of tokens) {
    if (tok.kind === "text") {
      emitText(state, decodeEntities(tok.value), tok.offset);
    } else {
      handleTag(state, tok);
    }
  }
  const lastToken = tokens.at(-1);
  state.pairs.push({
    md: state.out.length,
    src: lastToken ? lastToken.offset + lastToken.value.length : 0,
  });
  return { markdown: state.out.replaceAll(/\n{3,}/g, "\n\n").trimEnd(), pairs: state.pairs };
}

function emitText(state: RenderState, text: string, srcOffset: number): void {
  if (!text) return;
  const collapsed = state.inPre ? text : text.replaceAll(/\s+/g, " ");
  if (!collapsed || (collapsed === " " && state.out.endsWith(" "))) return;
  state.pairs.push({ md: state.out.length, src: srcOffset });
  state.out += collapsed;
}

type TagHandler = (state: RenderState, raw: string, name: string, closing: boolean) => void;

const LITERAL_EMIT = new Map<string, string>([
  ["br", "\n"],
  ["hr", "\n\n---\n\n"],
  ["p", "\n\n"],
  ["div", "\n\n"],
  ["section", "\n\n"],
  ["article", "\n\n"],
  ["strong", "**"],
  ["b", "**"],
  ["em", "*"],
  ["i", "*"],
]);

const TAG_HANDLERS = new Map<string, TagHandler>([
  ["h1", emitHeading],
  ["h2", emitHeading],
  ["h3", emitHeading],
  ["h4", emitHeading],
  ["h5", emitHeading],
  ["h6", emitHeading],
  ["code", emitCode],
  ["pre", emitPre],
  ["blockquote", emitBlockquote],
  ["ul", emitList],
  ["ol", emitList],
  ["li", emitListItem],
  ["a", emitAnchor],
]);

function handleTag(state: RenderState, tok: Token): void {
  const raw = tok.value;
  const closing = raw.startsWith("</");
  const name = extractTagName(raw.slice(closing ? 2 : 1));

  const literal = LITERAL_EMIT.get(name);
  if (literal !== undefined) {
    state.out += literal;
    return;
  }
  const handler = TAG_HANDLERS.get(name);
  if (handler) handler(state, raw, name, closing);
}

/**
 * Return the lowercased tag name at the start of `rest` — everything up
 * to the first whitespace, `/`, or `>`. Pure indexOf scan, no regex.
 */
const TAG_NAME_TERMINATORS = new Set(["\t", "\n", "\v", "\f", "\r", " ", "/", ">"]);

function extractTagName(rest: string): string {
  let end = rest.length;
  for (let i = 0; i < rest.length; i++) {
    if (TAG_NAME_TERMINATORS.has(rest[i])) {
      end = i;
      break;
    }
  }
  return rest.slice(0, end).toLowerCase();
}

function emitHeading(state: RenderState, _raw: string, name: string, closing: boolean): void {
  if (closing) {
    state.out += "\n\n";
    return;
  }
  const n = Number(name.slice(1));
  state.out += "\n\n" + "#".repeat(n) + " ";
}

function emitCode(state: RenderState): void {
  if (!state.inPre) state.out += "`";
}

function emitPre(state: RenderState, _raw: string, _name: string, closing: boolean): void {
  state.inPre = !closing;
  state.out += "\n```\n";
}

function emitBlockquote(state: RenderState, _raw: string, _name: string, closing: boolean): void {
  state.out += closing ? "\n\n" : "\n\n> ";
}

function emitList(state: RenderState, _raw: string, name: string, closing: boolean): void {
  if (name !== "ul" && name !== "ol") return;
  if (closing) {
    state.lists.pop();
    if (state.listDepth > 0) state.listDepth--;
  } else {
    state.lists.push({ kind: name, index: 0 });
    state.listDepth++;
  }
  state.out += "\n";
}

function emitListItem(state: RenderState, _raw: string, _name: string, closing: boolean): void {
  if (closing) {
    state.out += "\n";
    return;
  }
  const top = state.lists.at(-1);
  const indent = "  ".repeat(Math.max(0, state.listDepth - 1));
  if (top?.kind === "ol") {
    top.index += 1;
    state.out += `\n${indent}${top.index}. `;
  } else {
    state.out += `\n${indent}- `;
  }
}

function emitAnchor(state: RenderState, raw: string, _name: string, closing: boolean): void {
  if (closing) {
    state.out += "]()";
    return;
  }
  const href = /href=["']([^"']+)["']/.exec(raw)?.[1];
  if (href) state.out += "[";
}

function decodeEntities(s: string): string {
  return s
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replaceAll(/&#x([0-9a-f]+);/gi, (_, h: string) =>
      String.fromCodePoint(Number.parseInt(h, 16)),
    );
}
