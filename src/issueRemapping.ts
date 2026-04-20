import type { Issue, IssueWithId, OffsetMap } from "./types.js";

/**
 * Translate a single markdown offset back to an offset in the original
 * source text using the `OffsetMap` emitted by the converter.
 *
 * Strategy: binary-search for the last pair with `md <= offset`, then
 * use the straight-line `src + (offset - md)` when that delta is
 * smaller than the distance to the NEXT pair. If we'd overshoot the
 * next pair, clamp to its `src`.
 */
export function remapOffset(map: OffsetMap, mdOffset: number): number {
  const pairs = map.pairs;
  if (!pairs.length) return mdOffset;
  if (mdOffset <= pairs[0].md) return pairs[0].src;
  if (mdOffset >= pairs[pairs.length - 1].md) return pairs[pairs.length - 1].src;

  let lo = 0;
  let hi = pairs.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >>> 1;
    if (pairs[mid].md <= mdOffset) lo = mid;
    else hi = mid;
  }
  const low = pairs[lo];
  const high = pairs[hi];
  const deltaMd = mdOffset - low.md;
  const spanMd = high.md - low.md;
  const spanSrc = high.src - low.src;
  if (spanMd <= 0) return low.src;
  // Preserve offset delta but don't exceed the next pair's src.
  const projected = low.src + Math.min(deltaMd, spanSrc);
  return projected;
}

export function remapIssue(issue: Issue, map: OffsetMap): Issue {
  const start = remapOffset(map, issue.position.start);
  const end = Math.max(start, remapOffset(map, issue.position.end));
  return {
    ...issue,
    position: {
      ...issue.position,
      start,
      end,
    },
  };
}

/**
 * Build a deterministic id from issue content so the same issue from
 * a later scan replaces the previous one without causing duplicates.
 */
export function issueId(issue: Issue): string {
  const parts = [
    issue.agent,
    issue.category ?? "",
    issue.severity,
    String(issue.position.start),
    String(issue.position.end),
    hash32(issue.explanation),
    hash32(issue.suggestion ?? ""),
  ];
  return parts.join(":");
}

export function withIds(issues: readonly Issue[]): IssueWithId[] {
  return issues.map((issue) => ({ ...issue, id: issueId(issue) }));
}

function hash32(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}
