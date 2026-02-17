import { describe, it, expect, beforeEach, vi } from "vitest";
import * as vscode from "vscode";
import { StatusBarManager } from "../src/statusBarManager";
import { ContentScores } from "../src/types";

function createMockStatusBarItem() {
  return {
    text: "",
    tooltip: "" as string | undefined,
    command: "" as string | undefined,
    backgroundColor: undefined as vscode.ThemeColor | undefined,
    show: vi.fn(),
    hide: vi.fn(),
    dispose: vi.fn(),
    name: "",
  };
}

describe("StatusBarManager", () => {
  let statusBar: StatusBarManager;
  let mockItem: ReturnType<typeof createMockStatusBarItem>;

  beforeEach(() => {
    mockItem = createMockStatusBarItem();
    statusBar = new StatusBarManager(mockItem as unknown as vscode.StatusBarItem);
  });

  describe("showScore", () => {
    it("should display green emoji for scores >= 90", () => {
      const scores: ContentScores = { overall: 95, grammar: 90, consistency: 100, terminology: 95 };
      statusBar.showScore(scores);

      expect(mockItem.text).toBe("🟢 MarkupAI: 95");
      expect(mockItem.command).toBe("markupai.showScores");
      expect(mockItem.backgroundColor).toBeUndefined();
      expect(mockItem.show).toHaveBeenCalled();
    });

    it("should display yellow emoji for scores >= 70 and < 90", () => {
      const scores: ContentScores = { overall: 75, grammar: 70, consistency: 80, terminology: 75 };
      statusBar.showScore(scores);

      expect(mockItem.text).toBe("🟡 MarkupAI: 75");
    });

    it("should display orange emoji for scores >= 50 and < 70", () => {
      const scores: ContentScores = { overall: 55, grammar: 50, consistency: 60, terminology: 55 };
      statusBar.showScore(scores);

      expect(mockItem.text).toBe("🟠 MarkupAI: 55");
    });

    it("should display red emoji for scores < 50", () => {
      const scores: ContentScores = { overall: 30, grammar: 20, consistency: 40, terminology: 30 };
      statusBar.showScore(scores);

      expect(mockItem.text).toBe("🔴 MarkupAI: 30");
    });

    it("should include detailed tooltip with all scores", () => {
      const scores: ContentScores = { overall: 85, grammar: 90, consistency: 80, terminology: 85 };
      statusBar.showScore(scores);

      expect(mockItem.tooltip).toContain("Grammar: 90");
      expect(mockItem.tooltip).toContain("Consistency: 80");
      expect(mockItem.tooltip).toContain("Terminology: 85");
    });
  });

  describe("showNoToken", () => {
    it("should display token prompt with warning background", () => {
      statusBar.showNoToken();

      expect(mockItem.text).toBe("$(key) MarkupAI: Add API Token");
      expect(mockItem.command).toBe("markupai.configureApiToken");
      expect(mockItem.backgroundColor).toBeInstanceOf(vscode.ThemeColor);
      expect(mockItem.show).toHaveBeenCalled();
    });
  });

  describe("showChecking", () => {
    it("should display checking spinner", () => {
      statusBar.showChecking();

      expect(mockItem.text).toBe("$(sync~spin) MarkupAI: Checking...");
      expect(mockItem.tooltip).toBe("Checking content...");
      expect(mockItem.command).toBeUndefined();
      expect(mockItem.backgroundColor).toBeUndefined();
      expect(mockItem.show).toHaveBeenCalled();
    });

    it("should reset stale state from showNoToken", () => {
      statusBar.showNoToken();
      statusBar.showChecking();

      expect(mockItem.command).toBeUndefined();
      expect(mockItem.backgroundColor).toBeUndefined();
    });
  });

  describe("showDisabled", () => {
    it("should display disabled state", () => {
      statusBar.showDisabled();

      expect(mockItem.text).toBe("$(circle-slash) MarkupAI: Disabled");
      expect(mockItem.command).toBe("markupai.enableIssues");
      expect(mockItem.backgroundColor).toBeUndefined();
      expect(mockItem.show).toHaveBeenCalled();
    });
  });

  describe("showError", () => {
    it("should display error indicator", () => {
      statusBar.showError();

      expect(mockItem.text).toBe("⚠️ MarkupAI: Error");
      expect(mockItem.tooltip).toBe("An error occurred while checking content");
      expect(mockItem.command).toBeUndefined();
      expect(mockItem.backgroundColor).toBeUndefined();
      expect(mockItem.show).toHaveBeenCalled();
    });

    it("should reset stale state from showNoToken", () => {
      statusBar.showNoToken();
      statusBar.showError();

      expect(mockItem.command).toBeUndefined();
      expect(mockItem.backgroundColor).toBeUndefined();
    });
  });

  describe("hide", () => {
    it("should hide the status bar item", () => {
      statusBar.hide();

      expect(mockItem.hide).toHaveBeenCalled();
    });
  });

  describe("update", () => {
    it("should hide when scores are null", () => {
      statusBar.update(null);

      expect(mockItem.hide).toHaveBeenCalled();
    });

    it("should show score when scores are provided", () => {
      const scores: ContentScores = { overall: 85, grammar: 90, consistency: 80, terminology: 85 };
      statusBar.update(scores);

      expect(mockItem.text).toContain("MarkupAI: 85");
      expect(mockItem.show).toHaveBeenCalled();
    });
  });
});
