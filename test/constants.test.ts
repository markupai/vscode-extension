import { describe, it, expect } from "vitest";
import {
  POLL_INTERVAL_MS,
  POLL_TIMEOUT_MS,
  MAX_TEXT_LENGTH,
  ENVIRONMENT_URLS,
  OAUTH_PROVIDER,
  INTEGRATION_ID,
  USER_MESSAGE_PREFIX,
  SUPPORTED_FILE_EXTENSIONS,
} from "../src/constants";

describe("constants", () => {
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

  describe("POLL_TIMEOUT_MS", () => {
    it("should be defined", () => {
      expect(POLL_TIMEOUT_MS).toBeDefined();
    });

    it("should be a positive number", () => {
      expect(POLL_TIMEOUT_MS).toBeGreaterThan(0);
    });

    it("should allow for 2 minutes of polling", () => {
      expect(POLL_TIMEOUT_MS).toBe(120000);
    });

    it("should allow multiple poll attempts within the timeout", () => {
      expect(POLL_TIMEOUT_MS / POLL_INTERVAL_MS).toBeGreaterThanOrEqual(2);
    });
  });

  describe("MAX_TEXT_LENGTH", () => {
    it("should be 100000 characters", () => {
      expect(MAX_TEXT_LENGTH).toBe(100000);
    });
  });

  describe("ENVIRONMENT_URLS", () => {
    it("should define the prod API URL", () => {
      expect(ENVIRONMENT_URLS.prod).toBe("https://api.markup.ai");
    });

    it("should define the dev API URL", () => {
      expect(ENVIRONMENT_URLS.dev).toBe("https://api.dev.markup.ai");
    });

    it("should only contain prod and dev environments", () => {
      expect(Object.keys(ENVIRONMENT_URLS).sort((a, b) => a.localeCompare(b))).toEqual([
        "dev",
        "prod",
      ]);
    });

    it("should use https for all environments", () => {
      Object.values(ENVIRONMENT_URLS).forEach((url) => {
        expect(url.startsWith("https://")).toBe(true);
      });
    });
  });

  describe("OAUTH_PROVIDER", () => {
    it("should be the figma integration", () => {
      expect(OAUTH_PROVIDER).toBe("figma");
    });
  });

  describe("INTEGRATION_ID", () => {
    it("should identify the VS Code extension", () => {
      expect(INTEGRATION_ID).toBe("vscode_extension");
    });
  });

  describe("USER_MESSAGE_PREFIX", () => {
    it("should prefix messages with MarkupAI", () => {
      expect(USER_MESSAGE_PREFIX).toBe("MarkupAI: ");
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
