import { describe, it, expect } from "vitest";
import type {
  ContentIssue,
  RiskSummary,
  DocumentAssessment,
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
        category: "Spelling and Grammar",
        message: "Test message",
        suggestion: "Test suggestion",
        originalText: "test text",
        severity: "high",
      };

      expect(issue.id).toBe("test-1");
      expect(issue.category).toBe("Spelling and Grammar");
      expect(issue.severity).toBe("high");
    });

    it("should support free-form categories", () => {
      const categories = ["Spelling and Grammar", "Terminology", "Tone of Voice", "Clarity"];

      categories.forEach((category) => {
        const issue: ContentIssue = {
          id: "1",
          startIndex: 0,
          endIndex: 5,
          category,
          message: "test",
          suggestion: "test",
          originalText: "test",
          severity: "medium",
        };
        expect(issue.category).toBe(category);
      });
    });

    it("should support all severity levels", () => {
      const severities: ContentIssue["severity"][] = ["high", "medium", "low"];

      severities.forEach((severity) => {
        const issue: ContentIssue = {
          id: "1",
          startIndex: 0,
          endIndex: 5,
          category: "Grammar",
          message: "test",
          suggestion: "test",
          originalText: "test",
          severity,
        };
        expect(issue.severity).toBe(severity);
      });
    });

    it("should allow optional guidelineName", () => {
      const issue: ContentIssue = {
        id: "1",
        startIndex: 0,
        endIndex: 5,
        category: "Grammar",
        guidelineName: "Use active voice",
        message: "test",
        suggestion: "test",
        originalText: "test",
        severity: "medium",
      };

      expect(issue.category).toBe("Grammar");
      expect(issue.guidelineName).toBe("Use active voice");
    });
  });

  describe("RiskSummary", () => {
    it("should allow creating a valid RiskSummary object", () => {
      const risk: RiskSummary = {
        high: 1,
        medium: 2,
        low: 3,
        total: 6,
      };

      expect(risk.high).toBe(1);
      expect(risk.medium).toBe(2);
      expect(risk.low).toBe(3);
      expect(risk.total).toBe(6);
    });

    it("should allow a zero-issue summary", () => {
      const risk: RiskSummary = {
        high: 0,
        medium: 0,
        low: 0,
        total: 0,
      };

      expect(risk.total).toBe(0);
    });
  });

  describe("DocumentAssessment", () => {
    it("should allow assessment without a score", () => {
      const assessment: DocumentAssessment = {
        risk: { high: 1, medium: 2, low: 0, total: 3 },
      };

      expect(assessment.risk.total).toBe(3);
      expect(assessment.score).toBeUndefined();
    });

    it("should allow assessment with a numeric score", () => {
      const assessment: DocumentAssessment = {
        risk: { high: 0, medium: 1, low: 2, total: 3 },
        score: 85,
      };

      expect(assessment.score).toBe(85);
    });
  });

  describe("CheckResult", () => {
    it("should combine issues and assessment", () => {
      const result: CheckResult = {
        issues: [
          {
            id: "1",
            startIndex: 0,
            endIndex: 5,
            category: "Grammar",
            message: "test",
            suggestion: "test",
            originalText: "test",
            severity: "high",
          },
        ],
        assessment: {
          risk: { high: 1, medium: 0, low: 0, total: 1 },
          score: 85,
        },
      };

      expect(result.issues).toHaveLength(1);
      expect(result.assessment.risk.high).toBe(1);
      expect(result.assessment.score).toBe(85);
    });

    it("should allow empty issues array", () => {
      const result: CheckResult = {
        issues: [],
        assessment: {
          risk: { high: 0, medium: 0, low: 0, total: 0 },
        },
      };

      expect(result.issues).toHaveLength(0);
      expect(result.assessment.risk.total).toBe(0);
    });
  });

  describe("StyleGuideOption", () => {
    it("should allow creating a default style guide", () => {
      const guide: StyleGuideOption = {
        id: "guide-1",
        name: "Organization Default",
        isDefault: true,
      };

      expect(guide.id).toBe("guide-1");
      expect(guide.isDefault).toBe(true);
    });

    it("should allow creating a non-default style guide with language", () => {
      const guide: StyleGuideOption = {
        id: "custom-123",
        name: "My Custom Guide",
        isDefault: false,
        language: "en-US",
      };

      expect(guide.id).toBe("custom-123");
      expect(guide.isDefault).toBe(false);
      expect(guide.language).toBe("en-US");
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
        category: "Grammar",
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
        category: "Grammar",
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
