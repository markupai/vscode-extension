import {
  buildAlignmentMap,
  normalizeForComparison,
  remapRange,
} from "@markupai/format-offset-mapper";

/** Half-open [start, end) span, mirroring the adapter's ContentRange. */
export interface SpanRange {
  start: number;
  end: number;
}

/**
 * Snapshot of one sidebar check. The sidebar's ranges (card highlight,
 * apply suggestion) are always relative to the content it checked — this
 * session resolves them against the live document, however much the user
 * has edited since.
 *
 * The snapshot is immutable: every resolution maps from the original
 * checked surface to the current text. Resolution is tiered by cost:
 *
 *   1. Document unchanged → direct offset (plus selection base offset).
 *   2. Edited → character alignment map (format-offset-mapper), built once
 *      per document version and cached; O(1) per range afterwards. The
 *      landing surface is verified against the expected original text
 *      (exactly, then whitespace-tolerant).
 *   3. Verification failed → nearest-occurrence search around the mapped
 *      position.
 *   4. Still nothing → null; callers surface TextLookupError so the
 *      sidebar can invalidate the card instead of acting on wrong text.
 */
export class CheckSession {
  private alignmentCache: { version: number; map: Int32Array } | null = null;

  constructor(
    /** URI (string form) of the checked document. */
    readonly uri: string,
    /** Full document text at check time. */
    readonly snapshotText: string,
    /** Document version at check time. */
    readonly snapshotVersion: number,
    /**
     * Offset of the checked content within the document: 0 for whole-document
     * checks, the selection start for selection checks.
     */
    readonly baseOffset: number,
    /** Length of the content that was sent to the sidebar. */
    readonly checkedLength: number,
  ) {}

  /** The original surface a sidebar-relative range refers to. */
  expectedText(range: SpanRange): string {
    return this.snapshotText.slice(this.baseOffset + range.start, this.baseOffset + range.end);
  }

  /**
   * Resolve a sidebar-relative range to a span in the current document
   * text, or null when the content can no longer be located.
   */
  resolveRange(range: SpanRange, currentText: string, currentVersion: number): SpanRange | null {
    if (!isValidRange(range, this.checkedLength)) {
      return null;
    }

    const absolute: SpanRange = {
      start: this.baseOffset + range.start,
      end: this.baseOffset + range.end,
    };

    // Tier 1 — document unchanged since the check.
    if (currentVersion === this.snapshotVersion || currentText === this.snapshotText) {
      return absolute;
    }

    const expected = this.expectedText(range);

    // Tier 2 — alignment map, cached per document version.
    const map = this.getAlignmentMap(currentText, currentVersion);
    const mapped = remapRange(map, absolute.start, absolute.end);
    if (mapped) {
      const surface = currentText.slice(mapped.start, mapped.end);
      if (
        surface === expected ||
        normalizeForComparison(surface) === normalizeForComparison(expected)
      ) {
        return mapped;
      }
    }

    // Tier 3 — nearest occurrence of the original text.
    if (expected) {
      return findNearestOccurrence(currentText, expected, mapped?.start ?? absolute.start, 200);
    }

    return null;
  }

  private getAlignmentMap(currentText: string, currentVersion: number): Int32Array {
    if (this.alignmentCache?.version !== currentVersion) {
      this.alignmentCache = {
        version: currentVersion,
        map: buildAlignmentMap(this.snapshotText, currentText),
      };
    }
    return this.alignmentCache.map;
  }
}

/**
 * One active check session per document. A new check (full or selection)
 * replaces the previous session for that document.
 */
export class CheckSessionStore {
  private readonly sessions = new Map<string, CheckSession>();

  set(session: CheckSession): void {
    this.sessions.set(session.uri, session);
  }

  get(uri: string): CheckSession | undefined {
    return this.sessions.get(uri);
  }

  /** Session for the most recent check, regardless of document. */
  getLatest(): CheckSession | undefined {
    let latest: CheckSession | undefined;
    for (const session of this.sessions.values()) {
      latest = session;
    }
    return latest;
  }

  delete(uri: string): void {
    this.sessions.delete(uri);
  }

  clear(): void {
    this.sessions.clear();
  }
}

function isValidRange(range: SpanRange, maxLength: number): boolean {
  return (
    Number.isInteger(range.start) &&
    Number.isInteger(range.end) &&
    range.start >= 0 &&
    range.end >= range.start &&
    range.end <= maxLength
  );
}

/**
 * Find the occurrence of `needle` in `haystack` closest to `around`,
 * looking at most `radius` characters away. Returns null when absent.
 */
export function findNearestOccurrence(
  haystack: string,
  needle: string,
  around: number,
  radius: number,
): SpanRange | null {
  const windowStart = Math.max(0, around - radius);
  const windowEnd = Math.min(haystack.length, around + radius + needle.length);
  const window = haystack.slice(windowStart, windowEnd);

  let best: number | null = null;
  let from = 0;
  for (;;) {
    const found = window.indexOf(needle, from);
    if (found === -1) {
      break;
    }
    const absoluteIndex = windowStart + found;
    if (best === null || Math.abs(absoluteIndex - around) < Math.abs(best - around)) {
      best = absoluteIndex;
    }
    from = found + 1;
  }

  return best === null ? null : { start: best, end: best + needle.length };
}
