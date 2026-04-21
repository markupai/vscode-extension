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
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");
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
  state.pairs.push({
    md: state.out.length,
    src: tokens.length
      ? tokens[tokens.length - 1].offset + tokens[tokens.length - 1].value.length
      : 0,
  });
  return { markdown: state.out.replace(/\n{3,}/g, "\n\n").trimEnd(), pairs: state.pairs };
}

function emitText(state: RenderState, text: string, srcOffset: number): void {
  if (!text) return;
  const collapsed = state.inPre ? text : text.replace(/\s+/g, " ");
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
  const name = raw
    .slice(closing ? 2 : 1)
    .replace(/[\s>/].*$/, "")
    .toLowerCase();

  const literal = LITERAL_EMIT.get(name);
  if (literal !== undefined) {
    state.out += literal;
    return;
  }
  const handler = TAG_HANDLERS.get(name);
  if (handler) handler(state, raw, name, closing);
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
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(Number.parseInt(h, 16)));
}
