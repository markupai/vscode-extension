import { describe, it, expect, beforeEach, vi } from "vitest";
import * as vscode from "vscode";
import * as utils from "../src/utils";
import { ContentIssue } from "../src/types";

describe("utils", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getConfig", () => {
    it("should return workspace configuration for markupai", () => {
      const config = utils.getConfig();
      expect(vscode.workspace.getConfiguration).toHaveBeenCalledWith("markupai");
      expect(config).toBeDefined();
    });
  });

  describe("getApiToken", () => {
    it("should return API token from configuration", () => {
      const mockConfig = {
        get: vi.fn((key: string, defaultValue?: any) =>
          key === "apiToken" ? "test-token" : defaultValue,
        ),
      };
      vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(mockConfig as any);

      const token = utils.getApiToken();
      expect(token).toBe("test-token");
    });

    it("should return empty string if no token configured", () => {
      const mockConfig = {
        get: vi.fn((key: string, defaultValue?: any) => defaultValue),
      };
      vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(mockConfig as any);

      const token = utils.getApiToken();
      expect(token).toBe("");
    });
  });

  describe("hasApiToken", () => {
    it("should return true when token is configured", () => {
      const mockConfig = {
        get: vi.fn(() => "test-token"),
      };
      vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(mockConfig as any);

      expect(utils.hasApiToken()).toBe(true);
    });

    it("should return false when token is empty", () => {
      const mockConfig = {
        get: vi.fn(() => ""),
      };
      vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(mockConfig as any);

      expect(utils.hasApiToken()).toBe(false);
    });

    it("should return false when token is only whitespace", () => {
      const mockConfig = {
        get: vi.fn(() => "   "),
      };
      vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(mockConfig as any);

      expect(utils.hasApiToken()).toBe(false);
    });
  });

  describe("getDialect", () => {
    it("should return configured dialect", () => {
      const mockConfig = {
        get: vi.fn((key: string, defaultValue?: any) =>
          key === "dialect" ? "british_english" : defaultValue,
        ),
      };
      vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(mockConfig as any);

      expect(utils.getDialect()).toBe("british_english");
    });

    it("should return default american_english if not configured", () => {
      const mockConfig = {
        get: vi.fn((key: string, defaultValue?: any) => defaultValue),
      };
      vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(mockConfig as any);

      expect(utils.getDialect()).toBe("american_english");
    });
  });

  describe("getStyleGuide", () => {
    it("should return configured style guide", () => {
      const mockConfig = {
        get: vi.fn((key: string, defaultValue?: any) =>
          key === "styleGuide" ? "chicago" : defaultValue,
        ),
      };
      vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(mockConfig as any);

      expect(utils.getStyleGuide()).toBe("chicago");
    });

    it("should return default ap if not configured", () => {
      const mockConfig = {
        get: vi.fn((key: string, defaultValue?: any) => defaultValue),
      };
      vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(mockConfig as any);

      expect(utils.getStyleGuide()).toBe("ap");
    });
  });

  describe("indexToPosition", () => {
    it("should convert character index to VS Code position", () => {
      const mockDocument = {
        positionAt: vi.fn((offset: number) => new vscode.Position(1, offset - 10)),
      } as any;

      const position = utils.indexToPosition(mockDocument, 15);
      expect(mockDocument.positionAt).toHaveBeenCalledWith(15);
      expect(position).toBeInstanceOf(vscode.Position);
    });
  });

  describe("getSeverityForIssue", () => {
    it("should return Error severity for high severity issues", () => {
      const issue: ContentIssue = {
        id: "1",
        startIndex: 0,
        endIndex: 5,
        type: "grammar",
        message: "Test",
        suggestion: "Test",
        originalText: "test",
        severity: "high",
      };

      expect(utils.getSeverityForIssue(issue)).toBe(vscode.DiagnosticSeverity.Error);
    });

    it("should return Warning severity for medium severity issues", () => {
      const issue: ContentIssue = {
        id: "1",
        startIndex: 0,
        endIndex: 5,
        type: "grammar",
        message: "Test",
        suggestion: "Test",
        originalText: "test",
        severity: "medium",
      };

      expect(utils.getSeverityForIssue(issue)).toBe(vscode.DiagnosticSeverity.Warning);
    });

    it("should return Information severity for low severity issues", () => {
      const issue: ContentIssue = {
        id: "1",
        startIndex: 0,
        endIndex: 5,
        type: "grammar",
        message: "Test",
        suggestion: "Test",
        originalText: "test",
        severity: "low",
      };

      expect(utils.getSeverityForIssue(issue)).toBe(vscode.DiagnosticSeverity.Information);
    });
  });

  describe("getScoreEmoji", () => {
    it("should return green circle for scores >= 90", () => {
      expect(utils.getScoreEmoji(90)).toBe("🟢");
      expect(utils.getScoreEmoji(95)).toBe("🟢");
      expect(utils.getScoreEmoji(100)).toBe("🟢");
    });

    it("should return yellow circle for scores >= 70 and < 90", () => {
      expect(utils.getScoreEmoji(70)).toBe("🟡");
      expect(utils.getScoreEmoji(80)).toBe("🟡");
      expect(utils.getScoreEmoji(89)).toBe("🟡");
    });

    it("should return orange circle for scores >= 50 and < 70", () => {
      expect(utils.getScoreEmoji(50)).toBe("🟠");
      expect(utils.getScoreEmoji(60)).toBe("🟠");
      expect(utils.getScoreEmoji(69)).toBe("🟠");
    });

    it("should return red circle for scores < 50", () => {
      expect(utils.getScoreEmoji(0)).toBe("🔴");
      expect(utils.getScoreEmoji(25)).toBe("🔴");
      expect(utils.getScoreEmoji(49)).toBe("🔴");
    });
  });

  describe("getTypeEmoji", () => {
    it("should return correct emoji for grammar type", () => {
      expect(utils.getTypeEmoji("grammar")).toBe("📖");
    });

    it("should return correct emoji for spelling type", () => {
      expect(utils.getTypeEmoji("spelling")).toBe("📝");
    });

    it("should return correct emoji for consistency type", () => {
      expect(utils.getTypeEmoji("consistency")).toBe("🔄");
    });

    it("should return correct emoji for clarity type", () => {
      expect(utils.getTypeEmoji("clarity")).toBe("💡");
    });

    it("should return correct emoji for terminology type", () => {
      expect(utils.getTypeEmoji("terminology")).toBe("📚");
    });

    it("should return correct emoji for tone type", () => {
      expect(utils.getTypeEmoji("tone")).toBe("🎭");
    });

    it("should return default emoji for unknown type", () => {
      expect(utils.getTypeEmoji("unknown" as any)).toBe("📝");
    });
  });
});
