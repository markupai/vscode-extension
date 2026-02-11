import { describe, it, expect } from "vitest";
import {
  DIALECTS,
  BUILT_IN_STYLE_GUIDES,
  POLL_INTERVAL_MS,
  MAX_POLL_ATTEMPTS,
  SUPPORTED_FILE_EXTENSIONS,
} from "../src/constants";

describe("constants", () => {
  describe("DIALECTS", () => {
    it("should contain American English", () => {
      const american = DIALECTS.find((d) => d.value === "american_english");
      expect(american).toBeDefined();
      expect(american?.label).toBe("American English");
    });

    it("should contain British English", () => {
      const british = DIALECTS.find((d) => d.value === "british_english");
      expect(british).toBeDefined();
      expect(british?.label).toBe("British English");
    });

    it("should contain Canadian English", () => {
      const canadian = DIALECTS.find((d) => d.value === "canadian_english");
      expect(canadian).toBeDefined();
      expect(canadian?.label).toBe("Canadian English");
    });

    it("should contain exactly 3 dialects", () => {
      expect(DIALECTS).toHaveLength(3);
    });

    it("should have unique values", () => {
      const values = DIALECTS.map((d) => d.value);
      const uniqueValues = new Set(values);
      expect(uniqueValues.size).toBe(DIALECTS.length);
    });
  });

  describe("BUILT_IN_STYLE_GUIDES", () => {
    it("should contain AP Style Guide", () => {
      const ap = BUILT_IN_STYLE_GUIDES.find((g) => g.id === "ap");
      expect(ap).toBeDefined();
      expect(ap?.name).toBe("AP Style Guide");
      expect(ap?.isBuiltIn).toBe(true);
    });

    it("should contain Chicago Manual of Style", () => {
      const chicago = BUILT_IN_STYLE_GUIDES.find((g) => g.id === "chicago");
      expect(chicago).toBeDefined();
      expect(chicago?.name).toBe("Chicago Manual of Style");
      expect(chicago?.isBuiltIn).toBe(true);
    });

    it("should contain Microsoft Style Guide", () => {
      const microsoft = BUILT_IN_STYLE_GUIDES.find((g) => g.id === "microsoft");
      expect(microsoft).toBeDefined();
      expect(microsoft?.name).toBe("Microsoft Style Guide");
      expect(microsoft?.isBuiltIn).toBe(true);
    });

    it("should contain exactly 3 style guides", () => {
      expect(BUILT_IN_STYLE_GUIDES).toHaveLength(3);
    });

    it("should mark all as built-in", () => {
      BUILT_IN_STYLE_GUIDES.forEach((guide) => {
        expect(guide.isBuiltIn).toBe(true);
      });
    });

    it("should have unique IDs", () => {
      const ids = BUILT_IN_STYLE_GUIDES.map((g) => g.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(BUILT_IN_STYLE_GUIDES.length);
    });
  });

  describe("POLL_INTERVAL_MS", () => {
    it("should be defined", () => {
      expect(POLL_INTERVAL_MS).toBeDefined();
    });

    it("should be a positive number", () => {
      expect(POLL_INTERVAL_MS).toBeGreaterThan(0);
    });

    it("should be 2000ms (2 seconds)", () => {
      expect(POLL_INTERVAL_MS).toBe(2000);
    });
  });

  describe("MAX_POLL_ATTEMPTS", () => {
    it("should be defined", () => {
      expect(MAX_POLL_ATTEMPTS).toBeDefined();
    });

    it("should be a positive number", () => {
      expect(MAX_POLL_ATTEMPTS).toBeGreaterThan(0);
    });

    it("should be 60 attempts", () => {
      expect(MAX_POLL_ATTEMPTS).toBe(60);
    });

    it("should allow for 2 minutes of polling", () => {
      const totalTimeMs = POLL_INTERVAL_MS * MAX_POLL_ATTEMPTS;
      const totalTimeMinutes = totalTimeMs / 1000 / 60;
      expect(totalTimeMinutes).toBe(2);
    });
  });

  describe("SUPPORTED_FILE_EXTENSIONS", () => {
    it("should include markdown files", () => {
      expect(SUPPORTED_FILE_EXTENSIONS).toContain(".md");
    });

    it("should include text files", () => {
      expect(SUPPORTED_FILE_EXTENSIONS).toContain(".txt");
    });

    it("should include DITA files", () => {
      expect(SUPPORTED_FILE_EXTENSIONS).toContain(".dita");
    });

    it("should include HTML files", () => {
      expect(SUPPORTED_FILE_EXTENSIONS).toContain(".html");
      expect(SUPPORTED_FILE_EXTENSIONS).toContain(".htm");
    });

    it("should include XML files", () => {
      expect(SUPPORTED_FILE_EXTENSIONS).toContain(".xml");
    });

    it("should have at least 6 extensions", () => {
      expect(SUPPORTED_FILE_EXTENSIONS.length).toBeGreaterThanOrEqual(6);
    });

    it("should have unique extensions", () => {
      const uniqueExtensions = new Set(SUPPORTED_FILE_EXTENSIONS);
      expect(uniqueExtensions.size).toBe(SUPPORTED_FILE_EXTENSIONS.length);
    });

    it("should have all extensions start with a dot", () => {
      SUPPORTED_FILE_EXTENSIONS.forEach((ext) => {
        expect(ext.startsWith(".")).toBe(true);
      });
    });

    it("should have all extensions in lowercase", () => {
      SUPPORTED_FILE_EXTENSIONS.forEach((ext) => {
        expect(ext).toBe(ext.toLowerCase());
      });
    });
  });
});
