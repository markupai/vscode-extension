/**
 * Minimal HTML entity decoder for API-supplied issue text.
 *
 * The Style Agent API returns HTML-escaped strings (explanation, suggestions,
 * flagged text). Decoding must work in both the Node and web extension hosts,
 * so no DOMParser — just numeric references and the named entities the API
 * emits in practice. Unknown entities pass through unchanged.
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  copy: "©",
  reg: "®",
  trade: "™",
};

const ENTITY_PATTERN = /&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi;

export function decodeHtmlEntities(value: string): string {
  if (!value.includes("&")) {
    return value;
  }
  return value.replace(ENTITY_PATTERN, (match, body: string) => {
    if (body.startsWith("#")) {
      const codePoint =
        body[1] === "x" || body[1] === "X"
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      try {
        return String.fromCodePoint(codePoint);
      } catch {
        return match;
      }
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}
