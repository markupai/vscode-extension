import { describe, it, expect, beforeEach, vi } from "vitest";
import * as vscode from "vscode";
import { FindingsTreeDataProvider } from "../src/findingsTreeProvider";
import { ContentIssue, FindingTreeItem } from "../src/types";

function createIssue(overrides: Partial<ContentIssue> = {}): ContentIssue {
  return {
    id: "issue-1",
    startIndex: 0,
    endIndex: 5,
    category: "grammar",
    message: "Test grammar issue",
    suggestion: "fixed",
    originalText: "Hello",
    severity: "medium",
    ...overrides,
  };
}

describe("FindingsTreeDataProvider", () => {
  let provider: FindingsTreeDataProvider;
  let issuesMap: Map<string, ContentIssue[]>;

  beforeEach(() => {
    issuesMap = new Map();
    provider = new FindingsTreeDataProvider(() => issuesMap);
  });

  describe("getTreeItem", () => {
    it("should return expanded tree item for file type", () => {
      const children = [
        { type: "issue" as const, label: "Issue 1", uri: vscode.Uri.file("/test.md") },
      ];
      const element: FindingTreeItem = {
        type: "file",
        uri: vscode.Uri.file("/test.md"),
        label: "test.md",
        children,
      };

      const treeItem = provider.getTreeItem(element);

      expect(treeItem.label).toBe("test.md");
      expect(treeItem.collapsibleState).toBe(vscode.TreeItemCollapsibleState.Expanded);
      expect(treeItem.description).toBe("1 issues");
    });

    it("should return non-collapsible tree item for issue type", () => {
      const issue = createIssue({ severity: "high" });
      const element: FindingTreeItem = {
        type: "issue",
        uri: vscode.Uri.file("/test.md"),
        issue,
        label: "Test issue",
      };

      const treeItem = provider.getTreeItem(element);

      expect(treeItem.label).toBe("Test issue");
      expect(treeItem.collapsibleState).toBe(vscode.TreeItemCollapsibleState.None);
      expect(treeItem.description).toBe("grammar");
    });

    it("should use red icon for high severity issues", () => {
      const issue = createIssue({ severity: "high" });
      const element: FindingTreeItem = {
        type: "issue",
        uri: vscode.Uri.file("/test.md"),
        issue,
        label: "High issue",
      };

      const treeItem = provider.getTreeItem(element);
      const icon = treeItem.iconPath as vscode.ThemeIcon;

      expect(icon.id).toBe("circle-filled");
      expect(icon.color?.id).toBe("charts.red");
    });

    it("should use yellow icon for medium severity issues", () => {
      const issue = createIssue({ severity: "medium" });
      const element: FindingTreeItem = {
        type: "issue",
        uri: vscode.Uri.file("/test.md"),
        issue,
        label: "Medium issue",
      };

      const treeItem = provider.getTreeItem(element);
      const icon = treeItem.iconPath as vscode.ThemeIcon;

      expect(icon.id).toBe("circle-filled");
      expect(icon.color?.id).toBe("charts.yellow");
    });

    it("should use blue icon for low severity issues", () => {
      const issue = createIssue({ severity: "low" });
      const element: FindingTreeItem = {
        type: "issue",
        uri: vscode.Uri.file("/test.md"),
        issue,
        label: "Low issue",
      };

      const treeItem = provider.getTreeItem(element);
      const icon = treeItem.iconPath as vscode.ThemeIcon;

      expect(icon.id).toBe("circle-filled");
      expect(icon.color?.id).toBe("charts.blue");
    });

    it("should include goToIssue command on issue items", () => {
      const issue = createIssue();
      const uri = vscode.Uri.file("/test.md");
      const element: FindingTreeItem = {
        type: "issue",
        uri,
        issue,
        label: "Navigate issue",
      };

      const treeItem = provider.getTreeItem(element);

      expect(treeItem.command?.command).toBe("markupai.goToIssue");
      expect(treeItem.command?.arguments).toEqual([uri, issue]);
    });

    it("should handle issue element without issue data", () => {
      const element: FindingTreeItem = {
        type: "issue",
        label: "Malformed item",
      };

      const treeItem = provider.getTreeItem(element);

      expect(treeItem.label).toBe("Malformed item");
      expect(treeItem.collapsibleState).toBe(vscode.TreeItemCollapsibleState.None);
    });

    it("should include suggestion in tooltip when available", () => {
      const issue = createIssue({ suggestion: "better text" });
      const element: FindingTreeItem = {
        type: "issue",
        uri: vscode.Uri.file("/test.md"),
        issue,
        label: "Issue with tooltip",
      };

      const treeItem = provider.getTreeItem(element);
      const tooltip = treeItem.tooltip as vscode.MarkdownString;

      expect(tooltip.value).toContain("**Suggestion:** `better text`");
    });
  });

  describe("getChildren", () => {
    it("should return file items at root level", async () => {
      const uri = vscode.Uri.file("/test/file.md");
      issuesMap.set(uri.toString(), [createIssue()]);

      const children = await provider.getChildren();

      expect(children.length).toBe(1);
      expect(children[0].type).toBe("file");
    });

    it("should return issue children for a file element", async () => {
      const issueChildren: FindingTreeItem[] = [
        { type: "issue", label: "Child issue", issue: createIssue() },
      ];
      const fileElement: FindingTreeItem = {
        type: "file",
        label: "test.md",
        children: issueChildren,
      };

      const children = await provider.getChildren(fileElement);

      expect(children.length).toBe(1);
      expect(children[0].type).toBe("issue");
    });

    it("should return empty array for issue elements", async () => {
      const issueElement: FindingTreeItem = {
        type: "issue",
        label: "An issue",
        issue: createIssue(),
      };

      const children = await provider.getChildren(issueElement);

      expect(children).toEqual([]);
    });

    it("should return empty array when no issues exist", async () => {
      const children = await provider.getChildren();

      expect(children).toEqual([]);
    });
  });

  describe("filtering", () => {
    it("should filter by severity", () => {
      const uri = vscode.Uri.file("/test/file.md");
      issuesMap.set(uri.toString(), [
        createIssue({ id: "1", severity: "high" }),
        createIssue({ id: "2", severity: "medium" }),
        createIssue({ id: "3", severity: "low" }),
      ]);

      provider.setSeverityFilter("high");

      expect(provider.getTotalIssueCount()).toBe(1);
    });

    it("should filter by category", () => {
      const uri = vscode.Uri.file("/test/file.md");
      issuesMap.set(uri.toString(), [
        createIssue({ id: "1", category: "grammar" }),
        createIssue({ id: "2", category: "consistency" }),
      ]);

      provider.setCategoryFilter("grammar");

      expect(provider.getTotalIssueCount()).toBe(1);
    });

    it("should exclude all issues when no category matches", () => {
      const uri = vscode.Uri.file("/test/file.md");
      issuesMap.set(uri.toString(), [
        createIssue({ id: "1", category: "grammar" }),
        createIssue({ id: "2", category: "consistency" }),
      ]);

      provider.setCategoryFilter("terminology");

      expect(provider.getTotalIssueCount()).toBe(0);
    });

    it("should combine severity and category filters", () => {
      const uri = vscode.Uri.file("/test/file.md");
      issuesMap.set(uri.toString(), [
        createIssue({ id: "1", severity: "high", category: "grammar" }),
        createIssue({ id: "2", severity: "low", category: "grammar" }),
        createIssue({ id: "3", severity: "high", category: "consistency" }),
      ]);

      provider.setSeverityFilter("high");
      provider.setCategoryFilter("grammar");

      expect(provider.getTotalIssueCount()).toBe(1);
    });

    it("should clear all filters", () => {
      const uri = vscode.Uri.file("/test/file.md");
      issuesMap.set(uri.toString(), [
        createIssue({ id: "1", severity: "high" }),
        createIssue({ id: "2", severity: "low" }),
      ]);

      provider.setSeverityFilter("high");
      expect(provider.getTotalIssueCount()).toBe(1);

      provider.clearFilters();
      expect(provider.getTotalIssueCount()).toBe(2);
    });

    it("should return current filter state", () => {
      provider.setSeverityFilter("high");
      provider.setCategoryFilter("grammar");

      const filters = provider.getFilters();
      expect(filters.severity).toBe("high");
      expect(filters.category).toBe("grammar");
    });
  });

  describe("getAvailableCategories", () => {
    it("should return unique categories from all issues", () => {
      const uri = vscode.Uri.file("/test/file.md");
      issuesMap.set(uri.toString(), [
        createIssue({ category: "grammar" }),
        createIssue({ id: "2", category: "consistency" }),
        createIssue({ id: "3", category: "grammar" }),
      ]);

      const categories = provider.getAvailableCategories();

      expect(categories).toContain("grammar");
      expect(categories).toContain("consistency");
      expect(categories).toHaveLength(2);
    });

    it("should return empty array when no issues", () => {
      const categories = provider.getAvailableCategories();
      expect(categories).toEqual([]);
    });
  });

  describe("getAvailableSeverities", () => {
    it("should return unique severities from all issues", () => {
      const uri = vscode.Uri.file("/test/file.md");
      issuesMap.set(uri.toString(), [
        createIssue({ id: "1", severity: "high" }),
        createIssue({ id: "2", severity: "medium" }),
        createIssue({ id: "3", severity: "high" }),
      ]);

      const severities = provider.getAvailableSeverities();

      expect(severities).toContain("high");
      expect(severities).toContain("medium");
      expect(severities).toHaveLength(2);
    });

    it("should return empty array when no issues", () => {
      const severities = provider.getAvailableSeverities();
      expect(severities).toEqual([]);
    });
  });

  describe("getTotalIssueCount", () => {
    it("should return total count across all documents", () => {
      const uri1 = vscode.Uri.file("/test/file1.md");
      const uri2 = vscode.Uri.file("/test/file2.md");
      issuesMap.set(uri1.toString(), [createIssue({ id: "1" }), createIssue({ id: "2" })]);
      issuesMap.set(uri2.toString(), [createIssue({ id: "3" })]);

      expect(provider.getTotalIssueCount()).toBe(3);
    });

    it("should return 0 when no issues", () => {
      expect(provider.getTotalIssueCount()).toBe(0);
    });
  });

  describe("setShowAllFiles", () => {
    it("should update context and refresh", () => {
      provider.setShowAllFiles(false);

      expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
        "setContext",
        "markupai.showAllFiles",
        false,
      );
    });
  });

  describe("refresh", () => {
    it("should fire onDidChangeTreeData event", () => {
      const listener = vi.fn();
      provider.onDidChangeTreeData(listener);

      provider.refresh();

      expect(listener).toHaveBeenCalledWith(undefined);
    });
  });
});
