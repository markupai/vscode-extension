import type { ConvertedContent } from "../types.js";

/** For markdown/plain-text, the source IS the markdown — no remapping needed. */
export function markdownPassthrough(text: string): ConvertedContent {
  const pairs: { md: number; src: number }[] = [
    { md: 0, src: 0 },
    { md: text.length, src: text.length },
  ];
  return {
    markdown: text,
    originalText: text,
    offsetMap: { pairs },
    contentProfile: "markdown",
  };
}
