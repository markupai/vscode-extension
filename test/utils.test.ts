import { describe, it, expect, beforeEach, vi } from "vitest";
import * as vscode from "vscode";
import * as utils from "../src/utils";
import { ContentIssue, RiskSummary } from "../src/types";

function createMockConfig(
  getter: (key: string, defaultValue?: unknown) => unknown,
): vscode.WorkspaceConfiguration {
  return {
    get: vi.fn(getter),
    update: vi.fn(),
    has: vi.fn(() => true),
    inspect: vi.fn(),
  };
}

function createIssue(severity: ContentIssue["severity"]): ContentIssue {
  return {
    id: "1",
    startIndex: 0,
    endIndex: 5,
    category: "Grammar",
    message: "Test",
    suggestion: "Test",
    originalText: "test",
    severity,
  };
}

describe("utils", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(vscode.env, { uiKind: vscode.UIKind.Desktop });
  });

  describe("getConfig", () => {
    it("should return workspace configuration for markupai", () => {
      const config = utils.getConfig();
      expect(vscode.workspace.getConfiguration).toHaveBeenCalledWith("markupai");
      expect(config).toBeDefined();
    });
  });

  describe("getMode", () => {
    it("defaults to sidebar mode", () => {
      vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(
        createMockConfig((_key, defaultValue) => defaultValue),
      );

      expect(utils.getMode()).toBe("sidebar");
      expect(utils.isSidebarMode()).toBe(true);
    });

    it("returns native when configured", () => {
      vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(
        createMockConfig((key, defaultValue) => (key === "mode" ? "native" : defaultValue)),
      );

      expect(utils.getMode()).toBe("native");
      expect(utils.isSidebarMode()).toBe(false);
    });

    it("falls back to sidebar for unknown values", () => {
      vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(
        createMockConfig((key, defaultValue) => (key === "mode" ? "banana" : defaultValue)),
      );

      expect(utils.getMode()).toBe("sidebar");
    });
  });

  describe("getEnvironment", () => {
    it("should return configured dev environment", () => {
      vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(
        createMockConfig((key, defaultValue) => (key === "environment" ? "dev" : defaultValue)),
      );

      expect(utils.getEnvironment()).toBe("dev");
    });

    it("should return default prod if not configured", () => {
      vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(
        createMockConfig((_key, defaultValue) => defaultValue),
      );

      expect(utils.getEnvironment()).toBe("prod");
    });

    it("should fall back to prod for unknown values", () => {
      vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(
        createMockConfig((key, defaultValue) => (key === "environment" ? "staging" : defaultValue)),
      );

      expect(utils.getEnvironment()).toBe("prod");
    });
  });

  describe("getApiBaseUrl", () => {
    it("should return prod URL by default", () => {
      vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(
        createMockConfig((_key, defaultValue) => defaultValue),
      );

      expect(utils.getApiBaseUrl()).toBe("https://api.markup.ai");
    });

    it("should return dev URL when dev environment is configured", () => {
      vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(
        createMockConfig((key, defaultValue) => (key === "environment" ? "dev" : defaultValue)),
      );

      expect(utils.getApiBaseUrl()).toBe("https://api.dev.markup.ai");
    });
  });

  describe("getStyleGuideId", () => {
    it("should return configured style guide ID", () => {
      vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(
        createMockConfig((key, defaultValue) =>
          key === "styleGuide" ? "guide-123" : defaultValue,
        ),
      );

      expect(utils.getStyleGuideId()).toBe("guide-123");
    });

    it("should return empty string (organization default) if not configured", () => {
      vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(
        createMockConfig((_key, defaultValue) => defaultValue),
      );

      expect(utils.getStyleGuideId()).toBe("");
    });
  });

  describe("indexToPosition", () => {
    it("should convert character index to VS Code position", () => {
      const positionAtSpy = vi.fn((offset: number) => new vscode.Position(1, offset - 10));
      const mockDocument = {
        positionAt: positionAtSpy,
      } as unknown as vscode.TextDocument;

      const position = utils.indexToPosition(mockDocument, 15);
      expect(positionAtSpy).toHaveBeenCalledWith(15);
      expect(position).toBeInstanceOf(vscode.Position);
    });
  });

  describe("getSeverityForIssue", () => {
    it("should return Error severity for high severity issues", () => {
      expect(utils.getSeverityForIssue(createIssue("high"))).toBe(vscode.DiagnosticSeverity.Error);
    });

    it("should return Warning severity for medium severity issues", () => {
      expect(utils.getSeverityForIssue(createIssue("medium"))).toBe(
        vscode.DiagnosticSeverity.Warning,
      );
    });

    it("should return Information severity for low severity issues", () => {
      expect(utils.getSeverityForIssue(createIssue("low"))).toBe(
        vscode.DiagnosticSeverity.Information,
      );
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

  describe("getSeverityEmoji", () => {
    it("should return red circle for high severity", () => {
      expect(utils.getSeverityEmoji("high")).toBe("🔴");
    });

    it("should return yellow circle for medium severity", () => {
      expect(utils.getSeverityEmoji("medium")).toBe("🟡");
    });

    it("should return blue circle for low severity", () => {
      expect(utils.getSeverityEmoji("low")).toBe("🔵");
    });
  });

  describe("formatRiskSummary", () => {
    it("should format all risk levels when present", () => {
      const risk: RiskSummary = { high: 2, medium: 3, low: 11, total: 16 };
      expect(utils.formatRiskSummary(risk)).toBe("2H 3M 11L");
    });

    it("should omit risk levels with zero count", () => {
      expect(utils.formatRiskSummary({ high: 0, medium: 3, low: 1, total: 4 })).toBe("3M 1L");
      expect(utils.formatRiskSummary({ high: 1, medium: 0, low: 0, total: 1 })).toBe("1H");
      expect(utils.formatRiskSummary({ high: 0, medium: 0, low: 5, total: 5 })).toBe("5L");
    });

    it("should return 'No issues' when total is zero", () => {
      expect(utils.formatRiskSummary({ high: 0, medium: 0, low: 0, total: 0 })).toBe("No issues");
    });
  });

  describe("isWebEnvironment", () => {
    it("should return false when running on desktop", () => {
      Object.assign(vscode.env, { uiKind: vscode.UIKind.Desktop });
      expect(utils.isWebEnvironment()).toBe(false);
    });

    it("should return true when running on web", () => {
      Object.assign(vscode.env, { uiKind: vscode.UIKind.Web });
      expect(utils.isWebEnvironment()).toBe(true);
    });
  });

  describe("isSupportedScheme", () => {
    it("should return true for file scheme", () => {
      expect(utils.isSupportedScheme("file")).toBe(true);
    });

    it("should return true for untitled scheme", () => {
      expect(utils.isSupportedScheme("untitled")).toBe(true);
    });

    it("should return true for vscode-vfs scheme", () => {
      expect(utils.isSupportedScheme("vscode-vfs")).toBe(true);
    });

    it("should return true for github scheme", () => {
      expect(utils.isSupportedScheme("github")).toBe(true);
    });

    it("should return true for vscode-remote scheme", () => {
      expect(utils.isSupportedScheme("vscode-remote")).toBe(true);
    });

    it("should return false for unsupported schemes", () => {
      expect(utils.isSupportedScheme("ftp")).toBe(false);
      expect(utils.isSupportedScheme("http")).toBe(false);
      expect(utils.isSupportedScheme("")).toBe(false);
    });
  });

  describe("isCorsOrNetworkError", () => {
    it("should return true for 'Failed to fetch' errors", () => {
      expect(utils.isCorsOrNetworkError(new TypeError("Failed to fetch"))).toBe(true);
    });

    it("should return true for 'NetworkError' errors", () => {
      expect(utils.isCorsOrNetworkError(new Error("NetworkError when attempting to fetch"))).toBe(
        true,
      );
    });

    it("should return true for 'Network request failed' errors", () => {
      expect(utils.isCorsOrNetworkError(new Error("Network request failed"))).toBe(true);
    });

    it("should return true for CORS errors", () => {
      expect(
        utils.isCorsOrNetworkError(new Error("CORS policy: No 'Access-Control-Allow-Origin'")),
      ).toBe(true);
    });

    it("should return true for 'Load failed' errors (Safari)", () => {
      expect(utils.isCorsOrNetworkError(new TypeError("Load failed"))).toBe(true);
    });

    it("should return false for non-network errors", () => {
      expect(utils.isCorsOrNetworkError(new Error("Invalid API token"))).toBe(false);
      expect(utils.isCorsOrNetworkError(new Error("Timeout exceeded"))).toBe(false);
    });

    it("should return false for non-Error objects", () => {
      expect(utils.isCorsOrNetworkError("Failed to fetch")).toBe(false);
      expect(utils.isCorsOrNetworkError(null)).toBe(false);
      expect(utils.isCorsOrNetworkError(undefined)).toBe(false);
      expect(utils.isCorsOrNetworkError(42)).toBe(false);
      expect(utils.isCorsOrNetworkError({ message: "Failed to fetch" })).toBe(false);
    });

    it("should be case-insensitive", () => {
      expect(utils.isCorsOrNetworkError(new Error("FAILED TO FETCH"))).toBe(true);
      expect(utils.isCorsOrNetworkError(new Error("cors error"))).toBe(true);
    });
  });
});
