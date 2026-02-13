import { describe, it, expect } from "vitest";
import type {
  ContentIssue,
  ContentScores,
  CheckResult,
  StyleGuideOption,
  FindingTreeItem,
  FolderScannerItem,
} from "../src/types";
import * as vscode from "vscode";

describe("types", () => {
  describe("ContentIssue", () => {
    it("should allow creating a valid ContentIssue object", () => {
      const issue: ContentIssue = {
        id: "test-1",
        startIndex: 0,
        endIndex: 10,
        type: "grammar",
        message: "Test message",
        suggestion: "Test suggestion",
        originalText: "test text",
        severity: "high",
      };

      expect(issue.id).toBe("test-1");
      expect(issue.type).toBe("grammar");
      expect(issue.severity).toBe("high");
    });

    it("should support all issue types", () => {
      const types: ContentIssue["type"][] = [
        "spelling",
        "grammar",
        "consistency",
        "clarity",
        "terminology",
        "tone",
      ];

      types.forEach((type) => {
        const issue: ContentIssue = {
          id: "1",
          startIndex: 0,
          endIndex: 5,
          type,
          message: "test",
          suggestion: "test",
          originalText: "test",
          severity: "medium",
        };
        expect(issue.type).toBe(type);
      });
    });

    it("should support all severity levels", () => {
      const severities: ContentIssue["severity"][] = ["high", "medium", "low"];

      severities.forEach((severity) => {
        const issue: ContentIssue = {
          id: "1",
          startIndex: 0,
          endIndex: 5,
          type: "grammar",
          message: "test",
          suggestion: "test",
          originalText: "test",
          severity,
        };
        expect(issue.severity).toBe(severity);
      });
    });

    it("should allow optional category and subcategory", () => {
      const issue: ContentIssue = {
        id: "1",
        startIndex: 0,
        endIndex: 5,
        type: "grammar",
        category: "test-category",
        subcategory: "test-subcategory",
        message: "test",
        suggestion: "test",
        originalText: "test",
        severity: "medium",
      };

      expect(issue.category).toBe("test-category");
      expect(issue.subcategory).toBe("test-subcategory");
    });
  });

  describe("ContentScores", () => {
    it("should allow creating a valid ContentScores object", () => {
      const scores: ContentScores = {
        overall: 85,
        grammar: 90,
        consistency: 80,
        terminology: 85,
      };

      expect(scores.overall).toBe(85);
      expect(scores.grammar).toBe(90);
      expect(scores.consistency).toBe(80);
      expect(scores.terminology).toBe(85);
    });

    it("should accept scores in valid range 0-100", () => {
      const scores: ContentScores = {
        overall: 0,
        grammar: 50,
        consistency: 100,
        terminology: 75,
      };

      expect(scores.overall).toBe(0);
      expect(scores.grammar).toBe(50);
      expect(scores.consistency).toBe(100);
      expect(scores.terminology).toBe(75);
    });
  });

  describe("CheckResult", () => {
    it("should combine issues and scores", () => {
      const result: CheckResult = {
        issues: [
          {
            id: "1",
            startIndex: 0,
            endIndex: 5,
            type: "grammar",
            message: "test",
            suggestion: "test",
            originalText: "test",
            severity: "high",
          },
        ],
        scores: {
          overall: 85,
          grammar: 90,
          consistency: 80,
          terminology: 85,
        },
      };

      expect(result.issues).toHaveLength(1);
      expect(result.scores.overall).toBe(85);
    });

    it("should allow empty issues array", () => {
      const result: CheckResult = {
        issues: [],
        scores: {
          overall: 100,
          grammar: 100,
          consistency: 100,
          terminology: 100,
        },
      };

      expect(result.issues).toHaveLength(0);
      expect(result.scores.overall).toBe(100);
    });
  });

  describe("StyleGuideOption", () => {
    it("should allow creating built-in style guide", () => {
      const guide: StyleGuideOption = {
        id: "ap",
        name: "AP Style Guide",
        isBuiltIn: true,
      };

      expect(guide.id).toBe("ap");
      expect(guide.isBuiltIn).toBe(true);
    });

    it("should allow creating custom style guide", () => {
      const guide: StyleGuideOption = {
        id: "custom-123",
        name: "My Custom Guide",
        isBuiltIn: false,
      };

      expect(guide.id).toBe("custom-123");
      expect(guide.isBuiltIn).toBe(false);
    });
  });

  describe("FindingTreeItem", () => {
    it("should allow creating file type item", () => {
      const uri = vscode.Uri.parse("file:///test/file.md");
      const item: FindingTreeItem = {
        type: "file",
        uri,
        label: "file.md",
        children: [],
      };

      expect(item.type).toBe("file");
      expect(item.uri).toBe(uri);
      expect(item.label).toBe("file.md");
    });

    it("should allow creating issue type item", () => {
      const uri = vscode.Uri.parse("file:///test/file.md");
      const issue: ContentIssue = {
        id: "1",
        startIndex: 0,
        endIndex: 5,
        type: "grammar",
        message: "test",
        suggestion: "test",
        originalText: "test",
        severity: "high",
      };

      const item: FindingTreeItem = {
        type: "issue",
        uri,
        issue,
        label: "Grammar issue",
      };

      expect(item.type).toBe("issue");
      expect(item.issue).toBe(issue);
    });

    it("should allow nested children for file items", () => {
      const uri = vscode.Uri.parse("file:///test/file.md");
      const issue: ContentIssue = {
        id: "1",
        startIndex: 0,
        endIndex: 5,
        type: "grammar",
        message: "test",
        suggestion: "test",
        originalText: "test",
        severity: "high",
      };

      const fileItem: FindingTreeItem = {
        type: "file",
        uri,
        label: "file.md",
        children: [
          {
            type: "issue",
            uri,
            issue,
            label: "Grammar issue",
          },
        ],
      };

      expect(fileItem.children).toHaveLength(1);
      if (fileItem.children) {
        expect(fileItem.children[0].type).toBe("issue");
      }
    });
  });

  describe("FolderScannerItem", () => {
    it("should allow creating folder type item", () => {
      const uri = vscode.Uri.parse("file:///test/folder");
      const item: FolderScannerItem = {
        type: "folder",
        uri,
        label: "folder",
        isSelected: false,
      };

      expect(item.type).toBe("folder");
      expect(item.isSelected).toBe(false);
    });

    it("should allow creating file type item", () => {
      const uri = vscode.Uri.parse("file:///test/file.md");
      const item: FolderScannerItem = {
        type: "file",
        uri,
        label: "file.md",
        isSelected: true,
      };

      expect(item.type).toBe("file");
      expect(item.isSelected).toBe(true);
    });

    it("should allow nested children for folders", () => {
      const folderUri = vscode.Uri.parse("file:///test/folder");
      const fileUri = vscode.Uri.parse("file:///test/folder/file.md");

      const folderItem: FolderScannerItem = {
        type: "folder",
        uri: folderUri,
        label: "folder",
        isSelected: false,
        children: [
          {
            type: "file",
            uri: fileUri,
            label: "file.md",
            isSelected: true,
          },
        ],
      };

      expect(folderItem.children).toHaveLength(1);
      if (folderItem.children) {
        expect(folderItem.children[0].type).toBe("file");
      }
    });

    it("should allow toggling selection state", () => {
      const uri = vscode.Uri.parse("file:///test/file.md");
      const item: FolderScannerItem = {
        type: "file",
        uri,
        label: "file.md",
        isSelected: false,
      };

      expect(item.isSelected).toBe(false);
      item.isSelected = true;
      expect(item.isSelected).toBe(true);
    });
  });
});
