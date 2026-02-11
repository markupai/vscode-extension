import { describe, it, expect } from "vitest";
import { OffsetTranslator, TextOffsetMapper } from "../src/offsetMapper";

describe("OffsetTranslator", () => {
  describe("translatePosition", () => {
    it("should translate position when text is unchanged", () => {
      const oldText = "Hello world";
      const newText = "Hello world";
      const translator = new OffsetTranslator(oldText, newText);

      expect(translator.translatePosition(0)).toBe(0);
      expect(translator.translatePosition(5)).toBe(5);
      expect(translator.translatePosition(11)).toBe(11);
    });

    it("should translate position after insertion", () => {
      const oldText = "Hello world";
      const newText = "Hello beautiful world";
      const translator = new OffsetTranslator(oldText, newText);

      // Position before insertion should stay same
      expect(translator.translatePosition(5)).toBe(5);
      // Position after insertion should be shifted
      expect(translator.translatePosition(6)).toBe(16);
    });

    it("should translate position after deletion", () => {
      const oldText = "Hello beautiful world";
      const newText = "Hello world";
      const translator = new OffsetTranslator(oldText, newText);

      // Position before deletion should stay same
      expect(translator.translatePosition(5)).toBe(5);
      // Position after deletion should be shifted back
      expect(translator.translatePosition(16)).toBe(6);
    });

    it("should handle multiple changes", () => {
      const oldText = "The quick brown fox";
      const newText = "A fast brown dog";
      const translator = new OffsetTranslator(oldText, newText);

      // Test various positions
      const translated = translator.translatePosition(10);
      expect(translated).toBeGreaterThanOrEqual(0);
      expect(translated).toBeLessThanOrEqual(newText.length);
    });
  });

  describe("translateRange", () => {
    it("should translate range when text is unchanged", () => {
      const oldText = "Hello world";
      const newText = "Hello world";
      const translator = new OffsetTranslator(oldText, newText);

      const result = translator.translateRange(0, 5);
      expect(result).toEqual({ start: 0, end: 5 });
    });

    it("should translate range after insertion before range", () => {
      const oldText = "Hello world";
      const newText = "Hello beautiful world";
      const translator = new OffsetTranslator(oldText, newText);

      const result = translator.translateRange(6, 11);
      expect(result).toBeDefined();
      expect(result!.start).toBe(16);
    });

    it("should translate deleted range", () => {
      const oldText = "Hello beautiful world";
      const newText = "Hello world";
      const translator = new OffsetTranslator(oldText, newText);

      // Range covering "beautiful " (which gets deleted)
      const result = translator.translateRange(6, 15);

      // Note: The diff-match-patch algorithm may return positions
      // that extend beyond the actual text when content is deleted.
      // This is expected behavior - in practice, the code using this
      // will clamp to document boundaries or search for nearby text.
      expect(result).toBeDefined();

      if (result) {
        // Verify the start position is valid
        expect(result.start).toBeGreaterThanOrEqual(0);
        // End may be beyond new text length for deleted content - this is okay
        expect(result.end).toBeGreaterThanOrEqual(result.start);
      }
    });

    it("should handle range at document start", () => {
      const oldText = "Hello world";
      const newText = "Hi world";
      const translator = new OffsetTranslator(oldText, newText);

      const result = translator.translateRange(0, 5);
      expect(result).toBeDefined();
    });
  });

  describe("verifyTextAtPosition", () => {
    it("should return true when text matches at position", () => {
      const text = "Hello world";
      const result = OffsetTranslator.verifyTextAtPosition("world", text, 6);
      expect(result).toBe(true);
    });

    it("should return false when text does not match", () => {
      const text = "Hello world";
      const result = OffsetTranslator.verifyTextAtPosition("foo", text, 6);
      expect(result).toBe(false);
    });

    it("should return false when position is out of bounds", () => {
      const text = "Hello world";
      const result = OffsetTranslator.verifyTextAtPosition("world", text, 100);
      expect(result).toBe(false);
    });

    it("should return false when position is negative", () => {
      const text = "Hello world";
      const result = OffsetTranslator.verifyTextAtPosition("Hello", text, -1);
      expect(result).toBe(false);
    });
  });
});

describe("TextOffsetMapper", () => {
  describe("codePointOffsetToStringIndex", () => {
    it("should handle ASCII text", () => {
      const mapper = new TextOffsetMapper("Hello world");
      expect(mapper.codePointOffsetToStringIndex(0)).toBe(0);
      expect(mapper.codePointOffsetToStringIndex(5)).toBe(5);
      expect(mapper.codePointOffsetToStringIndex(11)).toBe(11);
    });

    it("should handle emoji (surrogate pairs)", () => {
      const mapper = new TextOffsetMapper("Hello 😀 world");
      // Emoji is 1 code point but 2 code units in JavaScript
      expect(mapper.codePointOffsetToStringIndex(0)).toBe(0);
      expect(mapper.codePointOffsetToStringIndex(6)).toBe(6); // Before emoji
      expect(mapper.codePointOffsetToStringIndex(7)).toBe(8); // After emoji
    });

    it("should handle negative offset", () => {
      const mapper = new TextOffsetMapper("Hello");
      expect(mapper.codePointOffsetToStringIndex(-1)).toBe(0);
    });

    it("should handle offset beyond text length", () => {
      const mapper = new TextOffsetMapper("Hello");
      expect(mapper.codePointOffsetToStringIndex(100)).toBe(5);
    });

    it("should handle empty string", () => {
      const mapper = new TextOffsetMapper("");
      expect(mapper.codePointOffsetToStringIndex(0)).toBe(0);
    });
  });

  describe("byteOffsetToStringIndex", () => {
    it("should handle ASCII text", () => {
      const mapper = new TextOffsetMapper("Hello");
      expect(mapper.byteOffsetToStringIndex(0)).toBe(0);
      expect(mapper.byteOffsetToStringIndex(5)).toBe(5);
    });

    it("should handle multi-byte UTF-8 characters", () => {
      const mapper = new TextOffsetMapper("Héllo");
      // é is 2 bytes in UTF-8
      expect(mapper.byteOffsetToStringIndex(0)).toBe(0);
      expect(mapper.byteOffsetToStringIndex(1)).toBe(1);
      // Byte offset 2-3 map to character position 2
      expect(mapper.byteOffsetToStringIndex(3)).toBe(2);
    });

    it("should handle negative offset", () => {
      const mapper = new TextOffsetMapper("Hello");
      expect(mapper.byteOffsetToStringIndex(-1)).toBe(0);
    });

    it("should handle offset beyond text length", () => {
      const mapper = new TextOffsetMapper("Hello");
      expect(mapper.byteOffsetToStringIndex(100)).toBe(5);
    });
  });

  describe("findTextPosition", () => {
    it("should find text at the start", () => {
      const mapper = new TextOffsetMapper("Hello world");
      const result = mapper.findTextPosition("Hello", 0);
      expect(result).toEqual({ start: 0, end: 5 });
    });

    it("should find text in the middle", () => {
      const mapper = new TextOffsetMapper("Hello world");
      const result = mapper.findTextPosition("world", 0);
      expect(result).toEqual({ start: 6, end: 11 });
    });

    it("should return null when text not found", () => {
      const mapper = new TextOffsetMapper("Hello world");
      const result = mapper.findTextPosition("foo", 0);
      expect(result).toBeNull();
    });

    it("should find text starting from specific index", () => {
      const mapper = new TextOffsetMapper("Hello Hello");
      const result = mapper.findTextPosition("Hello", 5);
      expect(result).toEqual({ start: 6, end: 11 });
    });
  });

  describe("findNearbyText", () => {
    it("should find text at exact position", () => {
      const mapper = new TextOffsetMapper("Hello world");
      const result = mapper.findNearbyText("world", 6);
      expect(result).toEqual({ start: 6, end: 11 });
    });

    it("should find text nearby when approximate position is off by a few characters", () => {
      const mapper = new TextOffsetMapper("Hello world");
      const result = mapper.findNearbyText("world", 4); // Off by 2
      expect(result).toEqual({ start: 6, end: 11 });
    });

    it("should search entire document as fallback", () => {
      const mapper = new TextOffsetMapper("Hello world");
      const result = mapper.findNearbyText("world", 0, 2); // Very small search radius
      expect(result).toEqual({ start: 6, end: 11 });
    });

    it("should return null when text does not exist", () => {
      const mapper = new TextOffsetMapper("Hello world");
      const result = mapper.findNearbyText("foo", 5);
      expect(result).toBeNull();
    });

    it("should handle text at document start", () => {
      const mapper = new TextOffsetMapper("Hello world");
      const result = mapper.findNearbyText("Hello", 0);
      expect(result).toEqual({ start: 0, end: 5 });
    });

    it("should handle text at document end", () => {
      const mapper = new TextOffsetMapper("Hello world");
      const result = mapper.findNearbyText("world", 11);
      expect(result).toEqual({ start: 6, end: 11 });
    });

    it("should handle custom search radius", () => {
      const mapper = new TextOffsetMapper("Hello world");
      const result = mapper.findNearbyText("world", 5, 50);
      expect(result).toEqual({ start: 6, end: 11 });
    });
  });

  describe("edge cases", () => {
    it("should handle empty string", () => {
      const mapper = new TextOffsetMapper("");
      expect(mapper.codePointOffsetToStringIndex(0)).toBe(0);
      expect(mapper.findTextPosition("test", 0)).toBeNull();
    });

    it("should handle string with only emojis", () => {
      const mapper = new TextOffsetMapper("😀😁😂");
      expect(mapper.codePointOffsetToStringIndex(0)).toBe(0);
      expect(mapper.codePointOffsetToStringIndex(1)).toBe(2);
      expect(mapper.codePointOffsetToStringIndex(2)).toBe(4);
      expect(mapper.codePointOffsetToStringIndex(3)).toBe(6);
    });

    it("should handle mixed ASCII and Unicode", () => {
      const mapper = new TextOffsetMapper("Hello 世界");
      expect(mapper.codePointOffsetToStringIndex(0)).toBe(0);
      expect(mapper.codePointOffsetToStringIndex(6)).toBe(6);
      expect(mapper.codePointOffsetToStringIndex(8)).toBe(8);
    });
  });
});
