import { DiffMatchPatch, Diff, DiffOp } from "diff-match-patch-ts";

// ============================================================================
// Offset Translator - Uses diff-match-patch to map positions between text versions
// ============================================================================

/**
 * Translates character positions from an old version of text to a new version
 * using the diff-match-patch algorithm. This handles insertions, deletions,
 * and modifications accurately.
 */
export class OffsetTranslator {
  private readonly diffs: Diff[];
  private readonly dmp: DiffMatchPatch;

  constructor(oldText: string, newText: string) {
    this.dmp = new DiffMatchPatch();
    this.diffs = this.dmp.diff_main(oldText, newText);
    // Cleanup for efficiency
    this.dmp.diff_cleanupEfficiency(this.diffs);
  }

  /**
   * Translate a position from the old text to the corresponding position in the new text.
   * Uses diff_xIndex internally which computes the equivalent location.
   *
   * @param oldPosition - Character index in the old text
   * @returns The corresponding character index in the new text
   */
  translatePosition(oldPosition: number): number {
    return this.diff_xIndex(this.diffs, oldPosition);
  }

  /**
   * Translate a range (start, end) from old text to new text positions.
   *
   * @param startIndex - Start position in old text
   * @param endIndex - End position in old text
   * @returns Object with translated start and end positions, or null if the range was deleted
   */
  translateRange(startIndex: number, endIndex: number): { start: number; end: number } | null {
    const newStart = this.translatePosition(startIndex);
    const newEnd = this.translatePosition(endIndex);

    // If start >= end after translation, the content was deleted
    if (newStart >= newEnd) {
      return null;
    }

    return { start: newStart, end: newEnd };
  }

  /**
   * Implementation of diff_xIndex - maps a character position in text1 to
   * the equivalent position in text2 based on the diff array.
   *
   * This is based on the Google diff-match-patch algorithm.
   *
   * @param diffs - Array of diff tuples
   * @param loc - Location in text1 to translate
   * @returns Location in text2
   */
  private diff_xIndex(diffs: Diff[], loc: number): number {
    let chars1 = 0;
    let chars2 = 0;
    let lastChars1 = 0;
    let lastChars2 = 0;

    for (const diff of diffs) {
      const op = diff[0];
      const text = diff[1];

      if (op !== DiffOp.Insert) {
        // Equality or deletion - advances position in text1
        chars1 += text.length;
      }
      if (op !== DiffOp.Delete) {
        // Equality or insertion - advances position in text2
        chars2 += text.length;
      }

      if (chars1 > loc) {
        // Overshot the location
        break;
      }
      lastChars1 = chars1;
      lastChars2 = chars2;
    }

    // If the location was deleted, return the position where deletion started in text2
    // Otherwise, add the remaining characters
    const lastDiff = diffs.at(-1);
    if (lastDiff !== undefined) {
      if (chars1 === loc && lastDiff[0] === DiffOp.Delete) {
        // The location is at a deletion point
        return lastChars2;
      }
    }

    return lastChars2 + (loc - lastChars1);
  }

  /**
   * Check if a specific text still exists at the translated position in the new text.
   *
   * @param originalText - The text that should be at the position
   * @param newText - The new document text
   * @param translatedStart - The translated start position
   * @returns true if the text matches at the translated position
   */
  static verifyTextAtPosition(
    originalText: string,
    newText: string,
    translatedStart: number,
  ): boolean {
    if (translatedStart < 0 || translatedStart + originalText.length > newText.length) {
      return false;
    }
    return (
      newText.substring(translatedStart, translatedStart + originalText.length) === originalText
    );
  }
}

// ============================================================================
// Text Offset Mapper - Handles Unicode encoding differences
// ============================================================================

/**
 * Maps between different text offset types:
 * - Unicode code points (what many APIs return)
 * - UTF-8 byte offsets (file-based APIs)
 * - UTF-16 code units (JavaScript string indices)
 *
 * Emojis and characters outside BMP cause differences:
 * - 😀 (U+1F600): 1 code point, 4 UTF-8 bytes, 2 UTF-16 code units
 */
export class TextOffsetMapper {
  private readonly text: string;
  private readonly codePointToStringIndex: number[] = [];
  private readonly byteToStringIndex: number[] = [];

  constructor(text: string) {
    this.text = text;
    this.buildMappings();
  }

  private buildMappings(): void {
    const encoder = new TextEncoder();
    let stringIndex = 0;

    // Build code point to string index mapping
    this.codePointToStringIndex.push(0);
    this.byteToStringIndex.push(0);

    for (const char of this.text) {
      // Each iteration gives us one code point (handles surrogate pairs)
      const charLength = char.length; // 1 for BMP, 2 for surrogate pairs
      const charBytes = encoder.encode(char).length;

      stringIndex += charLength;

      this.codePointToStringIndex.push(stringIndex);

      // Fill in byte offsets for each byte
      for (let i = 1; i <= charBytes; i++) {
        this.byteToStringIndex.push(stringIndex);
      }
    }
  }

  /**
   * Convert a Unicode code point offset to a JavaScript string index.
   * Use this if the API counts characters as code points.
   */
  codePointOffsetToStringIndex(codePointOffset: number): number {
    if (codePointOffset < 0) {
      return 0;
    }
    if (codePointOffset >= this.codePointToStringIndex.length) {
      return this.text.length;
    }
    return this.codePointToStringIndex[codePointOffset];
  }

  /**
   * Convert a UTF-8 byte offset to a JavaScript string index.
   * Use this if the API counts positions as byte offsets.
   */
  byteOffsetToStringIndex(byteOffset: number): number {
    if (byteOffset < 0) {
      return 0;
    }
    if (byteOffset >= this.byteToStringIndex.length) {
      return this.text.length;
    }
    return this.byteToStringIndex[byteOffset];
  }

  /**
   * Find the actual position of text in the string, searching from a start index.
   * Returns the start and end string indices.
   */
  findTextPosition(
    searchText: string,
    startFromIndex: number,
  ): { start: number; end: number } | null {
    const foundIndex = this.text.indexOf(searchText, startFromIndex);
    if (foundIndex === -1) {
      return null;
    }
    return {
      start: foundIndex,
      end: foundIndex + searchText.length,
    };
  }

  /**
   * Given an approximate start index and the original text, find the exact position.
   * This is useful when the offset might be slightly off due to encoding differences
   * or when the document has changed during an async operation.
   */
  findNearbyText(
    searchText: string,
    approximateIndex: number,
    searchRadius: number = 20,
  ): { start: number; end: number } | null {
    // Try exact position first
    const exactStart = Math.max(0, approximateIndex);
    if (this.text.substring(exactStart, exactStart + searchText.length) === searchText) {
      return { start: exactStart, end: exactStart + searchText.length };
    }

    // Search nearby with the given radius
    const searchStart = Math.max(0, approximateIndex - searchRadius);
    const searchEnd = Math.min(
      this.text.length,
      approximateIndex + searchRadius + searchText.length,
    );
    const searchArea = this.text.substring(searchStart, searchEnd);

    const foundInArea = searchArea.indexOf(searchText);
    if (foundInArea !== -1) {
      const actualStart = searchStart + foundInArea;
      return { start: actualStart, end: actualStart + searchText.length };
    }

    // If not found nearby, search the entire document as a fallback
    // This handles cases where text moved significantly due to edits
    const globalIndex = this.text.indexOf(searchText);
    if (globalIndex !== -1) {
      return { start: globalIndex, end: globalIndex + searchText.length };
    }

    return null;
  }
}
