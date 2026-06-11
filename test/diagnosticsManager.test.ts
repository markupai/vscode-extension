import { describe, it, expect, beforeEach, vi } from "vitest";
import * as vscode from "vscode";
import { DiagnosticsManager } from "../src/diagnosticsManager";
import { ContentIssue, DocumentAssessment, MarkupAIDiagnostic } from "../src/types";

function createMockDiagnosticCollection() {
  const store = new Map<string, vscode.Diagnostic[]>();
  return {
    set: vi.fn((uri: vscode.Uri, diagnostics: vscode.Diagnostic[]) => {
      store.set(uri.toString(), diagnostics);
    }),
    delete: vi.fn((uri: vscode.Uri) => {
      store.delete(uri.toString());
    }),
    clear: vi.fn(() => {
      store.clear();
    }),
    get: vi.fn((uri: vscode.Uri) => {
      return store.get(uri.toString());
    }),
    has: vi.fn((uri: vscode.Uri) => {
      return store.has(uri.toString());
    }),
    forEach: vi.fn((callback: (uri: vscode.Uri, diagnostics: vscode.Diagnostic[]) => void) => {
      const snapshot = Array.from(store.entries());
      for (const [uriString, diagnostics] of snapshot) {
        callback(vscode.Uri.parse(uriString), diagnostics);
      }
    }),
    dispose: vi.fn(),
  };
}

type MockDiagnosticCollection = ReturnType<typeof createMockDiagnosticCollection>;

function createMockDocument(text: string, uriPath: string = "/test/file.md") {
  const uri = vscode.Uri.file(uriPath);
  let offset = 0;
  return {
    uri,
    getText: vi.fn(() => text),
    positionAt: vi.fn((idx: number) => {
      offset = idx;
      return new vscode.Position(0, offset);
    }),
    offsetAt: vi.fn((pos: vscode.Position) => pos.character),
    lineCount: 1,
    fileName: uriPath,
  } as unknown as vscode.TextDocument;
}

function createIssue(overrides: Partial<ContentIssue> = {}): ContentIssue {
  return {
    id: "issue-1",
    startIndex: 0,
    endIndex: 5,
    category: "grammar",
    message: "Test issue",
    suggestion: "fixed",
    originalText: "Hello",
    severity: "medium",
    ...overrides,
  };
}

describe("DiagnosticsManager", () => {
  let manager: DiagnosticsManager;
  let mockCollection: MockDiagnosticCollection;

  beforeEach(() => {
    mockCollection = createMockDiagnosticCollection();
    manager = new DiagnosticsManager(mockCollection as unknown as vscode.DiagnosticCollection);
  });

  describe("issue and assessment management", () => {
    it("should store and retrieve issues", () => {
      const issues = [createIssue()];
      manager.setIssues("doc-1", issues);

      expect(manager.getIssues("doc-1")).toEqual(issues);
    });

    it("should return undefined for unknown document issues", () => {
      expect(manager.getIssues("unknown")).toBeUndefined();
    });

    it("should store and retrieve assessments", () => {
      const assessment: DocumentAssessment = {
        risk: { high: 1, medium: 2, low: 0, total: 3 },
        score: 85,
      };
      manager.setAssessment("doc-1", assessment);

      expect(manager.getAssessment("doc-1")).toEqual(assessment);
    });

    it("should return undefined for unknown document assessments", () => {
      expect(manager.getAssessment("unknown")).toBeUndefined();
    });

    it("should return all issues map", () => {
      const issues1 = [createIssue({ id: "1" })];
      const issues2 = [createIssue({ id: "2" })];
      manager.setIssues("doc-1", issues1);
      manager.setIssues("doc-2", issues2);

      const allIssues = manager.getAllIssues();
      expect(allIssues.size).toBe(2);
      expect(allIssues.get("doc-1")).toEqual(issues1);
      expect(allIssues.get("doc-2")).toEqual(issues2);
    });
  });

  describe("disabled categories", () => {
    it("should add and track disabled categories", () => {
      manager.addDisabledCategory("Grammar");

      expect(manager.getDisabledCategories().has("grammar")).toBe(true);
    });

    it("should remove disabled categories", () => {
      manager.addDisabledCategory("grammar");
      manager.removeDisabledCategory("grammar");

      expect(manager.getDisabledCategories().has("grammar")).toBe(false);
    });
  });

  describe("updateDiagnostics", () => {
    it("should create diagnostics from issues", () => {
      const doc = createMockDocument("Hello world");
      const issues = [createIssue({ startIndex: 0, endIndex: 5, originalText: "Hello" })];

      manager.updateDiagnostics(doc, issues);

      expect(mockCollection.set).toHaveBeenCalledWith(
        doc.uri,
        expect.arrayContaining([
          expect.objectContaining({
            message: "Test issue",
            source: "MarkupAI",
          }),
        ]),
      );
    });

    it("should set MarkupAI-specific properties on diagnostics", () => {
      const doc = createMockDocument("Hello world");
      const issues = [
        createIssue({
          suggestion: "Hi",
          originalText: "Hello",
          category: "grammar",
          guidelineName: "Use informal greetings",
          severity: "high",
        }),
      ];

      manager.updateDiagnostics(doc, issues);

      const setCall = mockCollection.set.mock.calls[0];
      const diagnostic = setCall[1][0] as MarkupAIDiagnostic;

      expect(diagnostic.markupaiSuggestion).toBe("Hi");
      expect(diagnostic.markupaiOriginalText).toBe("Hello");
      expect(diagnostic.markupaiCategory).toBe("grammar");
      expect(diagnostic.markupaiGuidelineName).toBe("Use informal greetings");
      expect(diagnostic.markupaiSeverity).toBe("high");
    });

    it("should skip issues from disabled categories", () => {
      const doc = createMockDocument("Hello world");
      manager.addDisabledCategory("grammar");

      const issues = [
        createIssue({ category: "grammar" }),
        createIssue({ id: "issue-2", category: "consistency" }),
      ];

      manager.updateDiagnostics(doc, issues);

      const setCall = mockCollection.set.mock.calls[0];
      const diagnostics = setCall[1] as MarkupAIDiagnostic[];
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0].markupaiCategory).toBe("consistency");
    });

    it("should handle empty issues array", () => {
      const doc = createMockDocument("Hello world");
      manager.updateDiagnostics(doc, []);

      expect(mockCollection.set).toHaveBeenCalledWith(doc.uri, []);
    });

    it("should handle issues with empty category", () => {
      const doc = createMockDocument("Hello world");
      const issues = [createIssue({ category: "" })];

      manager.updateDiagnostics(doc, issues);

      const setCall = mockCollection.set.mock.calls[0];
      const diagnostic = setCall[1][0] as MarkupAIDiagnostic;
      expect(diagnostic.markupaiCategory).toBe("");
    });
  });

  describe("updateDiagnostics with document changes", () => {
    it("should translate positions when document has changed", () => {
      const originalText = "Hello world";
      const currentText = "Hello beautiful world";
      const doc = createMockDocument(currentText);

      const issues = [
        createIssue({
          startIndex: 6,
          endIndex: 11,
          originalText: "world",
        }),
      ];

      manager.updateDiagnostics(doc, issues, originalText);

      expect(mockCollection.set).toHaveBeenCalled();
    });

    it("should skip issues when content was deleted and text not found", () => {
      const originalText = "Hello beautiful world";
      const currentText = "Hello world";
      const doc = createMockDocument(currentText);

      const issues = [
        createIssue({
          startIndex: 6,
          endIndex: 15,
          originalText: "beautiful",
        }),
      ];

      manager.updateDiagnostics(doc, issues, originalText);

      const setCall = mockCollection.set.mock.calls[0];
      const diagnostics = setCall[1];
      expect(diagnostics).toHaveLength(0);
    });

    it("should update stored issues when document changed", () => {
      const originalText = "Hello world";
      const currentText = "Hello brave world";
      const doc = createMockDocument(currentText);
      const docKey = doc.uri.toString();

      const issues = [
        createIssue({
          startIndex: 6,
          endIndex: 11,
          originalText: "world",
        }),
      ];

      manager.updateDiagnostics(doc, issues, originalText);

      const stored = manager.getIssues(docKey);
      expect(stored).toBeDefined();
    });
  });

  describe("filterDiagnosticsByDisabledCategories", () => {
    it("should filter out diagnostics for disabled categories", () => {
      const doc = createMockDocument("Hello world");
      const issues = [
        createIssue({ category: "grammar" }),
        createIssue({ id: "issue-2", category: "consistency" }),
      ];

      manager.updateDiagnostics(doc, issues);
      manager.addDisabledCategory("grammar");
      manager.filterDiagnosticsByDisabledCategories();

      expect(mockCollection.set).toHaveBeenCalled();
    });
  });

  describe("clearForDocument", () => {
    it("should clear diagnostics, issues, and assessments for a document", () => {
      const uri = vscode.Uri.file("/test/file.md");
      const docKey = uri.toString();

      manager.setIssues(docKey, [createIssue()]);
      manager.setAssessment(docKey, { risk: { high: 1, medium: 2, low: 0, total: 3 }, score: 85 });

      manager.clearForDocument(uri);

      expect(mockCollection.delete).toHaveBeenCalledWith(uri);
      expect(manager.getIssues(docKey)).toBeUndefined();
      expect(manager.getAssessment(docKey)).toBeUndefined();
    });
  });

  describe("clearAll", () => {
    it("should clear everything", () => {
      manager.setIssues("doc-1", [createIssue()]);
      manager.setAssessment("doc-1", { risk: { high: 1, medium: 2, low: 0, total: 3 }, score: 85 });
      manager.setIssues("doc-2", [createIssue({ id: "2" })]);

      manager.clearAll();

      expect(mockCollection.clear).toHaveBeenCalled();
      expect(manager.getAllIssues().size).toBe(0);
      expect(manager.getAssessment("doc-1")).toBeUndefined();
    });
  });

  describe("getDiagnosticsForUri", () => {
    it("should return diagnostics from the collection", () => {
      const uri = vscode.Uri.file("/test/file.md");
      manager.getDiagnosticsForUri(uri);

      expect(mockCollection.get).toHaveBeenCalledWith(uri);
    });
  });

  describe("getDiagnosticCollection", () => {
    it("should return the underlying collection", () => {
      const collection = manager.getDiagnosticCollection();
      expect(collection).toBeDefined();
    });
  });
});
