import { describe, it, expect, beforeEach, vi } from "vitest";
import * as vscode from "vscode";
import { StatusBarManager } from "../src/statusBarManager";
import { DocumentAssessment } from "../src/types";

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

  describe("showAssessment", () => {
    it("should display green emoji for scores >= 90", () => {
      const assessment: DocumentAssessment = {
        risk: { high: 0, medium: 1, low: 2, total: 3 },
        score: 95,
      };
      statusBar.showAssessment(assessment);

      expect(mockItem.text).toBe("🟢 MarkupAI: 95");
      expect(mockItem.command).toBe("markupai.showScores");
      expect(mockItem.backgroundColor).toBeUndefined();
      expect(mockItem.show).toHaveBeenCalled();
    });

    it("should display yellow emoji for scores >= 70 and < 90", () => {
      const assessment: DocumentAssessment = {
        risk: { high: 0, medium: 2, low: 3, total: 5 },
        score: 75,
      };
      statusBar.showAssessment(assessment);

      expect(mockItem.text).toBe("🟡 MarkupAI: 75");
    });

    it("should display orange emoji for scores >= 50 and < 70", () => {
      const assessment: DocumentAssessment = {
        risk: { high: 1, medium: 2, low: 3, total: 6 },
        score: 55,
      };
      statusBar.showAssessment(assessment);

      expect(mockItem.text).toBe("🟠 MarkupAI: 55");
    });

    it("should display red emoji for scores < 50", () => {
      const assessment: DocumentAssessment = {
        risk: { high: 5, medium: 4, low: 3, total: 12 },
        score: 30,
      };
      statusBar.showAssessment(assessment);

      expect(mockItem.text).toBe("🔴 MarkupAI: 30");
    });

    it("should display 'No issues' when there is no score and zero issues", () => {
      const assessment: DocumentAssessment = {
        risk: { high: 0, medium: 0, low: 0, total: 0 },
      };
      statusBar.showAssessment(assessment);

      expect(mockItem.text).toBe("$(check) MarkupAI: No issues");
      expect(mockItem.command).toBe("markupai.showScores");
      expect(mockItem.show).toHaveBeenCalled();
    });

    it("should display risk summary with high severity emoji when high risks exist", () => {
      const assessment: DocumentAssessment = {
        risk: { high: 2, medium: 3, low: 11, total: 16 },
      };
      statusBar.showAssessment(assessment);

      expect(mockItem.text).toBe("🔴 MarkupAI: 2H 3M 11L");
    });

    it("should display risk summary with medium severity emoji when medium is highest", () => {
      const assessment: DocumentAssessment = {
        risk: { high: 0, medium: 3, low: 1, total: 4 },
      };
      statusBar.showAssessment(assessment);

      expect(mockItem.text).toBe("🟡 MarkupAI: 3M 1L");
    });

    it("should display risk summary with low severity emoji when only low risks exist", () => {
      const assessment: DocumentAssessment = {
        risk: { high: 0, medium: 0, low: 5, total: 5 },
      };
      statusBar.showAssessment(assessment);

      expect(mockItem.text).toBe("🔵 MarkupAI: 5L");
    });

    it("should include detailed tooltip with risk counts", () => {
      const assessment: DocumentAssessment = {
        risk: { high: 1, medium: 2, low: 3, total: 6 },
      };
      statusBar.showAssessment(assessment);

      expect(mockItem.tooltip).toContain("High risk: 1");
      expect(mockItem.tooltip).toContain("Medium risk: 2");
      expect(mockItem.tooltip).toContain("Low risk: 3");
    });

    it("should include quality score in tooltip when present", () => {
      const assessment: DocumentAssessment = {
        risk: { high: 1, medium: 2, low: 3, total: 6 },
        score: 85,
      };
      statusBar.showAssessment(assessment);

      expect(mockItem.tooltip).toContain("Quality score: 85");
    });
  });

  describe("showSidebarMode", () => {
    it("shows the sidebar shortcut", () => {
      statusBar.showSidebarMode();

      expect(mockItem.text).toBe("$(layout-sidebar-left) MarkupAI");
      expect(mockItem.command).toBe("markupai.sidebar.focus");
      expect(mockItem.show).toHaveBeenCalled();
    });
  });

  describe("showSignedOut", () => {
    it("should display sign-in prompt with warning background", () => {
      statusBar.showSignedOut();

      expect(mockItem.text).toBe("$(key) MarkupAI: Sign in");
      expect(mockItem.command).toBe("markupai.signIn");
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

    it("should reset stale state from showSignedOut", () => {
      statusBar.showSignedOut();
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

    it("should reset stale state from showSignedOut", () => {
      statusBar.showSignedOut();
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
    it("should hide when assessment is null", () => {
      statusBar.update(null);

      expect(mockItem.hide).toHaveBeenCalled();
    });

    it("should show assessment when one is provided", () => {
      const assessment: DocumentAssessment = {
        risk: { high: 0, medium: 1, low: 2, total: 3 },
        score: 85,
      };
      statusBar.update(assessment);

      expect(mockItem.text).toContain("MarkupAI: 85");
      expect(mockItem.show).toHaveBeenCalled();
    });
  });
});
