import { describe, it, expect, vi } from "vitest";
import * as vscode from "vscode";
import { MarkupAICodeActionProvider } from "../src/codeActionProvider";
import { MarkupAIDiagnostic } from "../src/types";

function createMockDocument(uriPath: string = "/test/file.md") {
  const uri = vscode.Uri.file(uriPath);
  return {
    uri,
    getText: vi.fn(() => "Hello world"),
    positionAt: vi.fn((offset: number) => new vscode.Position(0, offset)),
  } as unknown as vscode.TextDocument;
}

function createMarkupDiagnostic(overrides: Partial<MarkupAIDiagnostic> = {}): MarkupAIDiagnostic {
  const range = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 5));
  const diag = new vscode.Diagnostic(
    range,
    "Test message",
    vscode.DiagnosticSeverity.Warning,
  ) as MarkupAIDiagnostic;

  diag.source = "MarkupAI";
  diag.markupaiSuggestion = "Hi";
  diag.markupaiOriginalText = "Hello";
  diag.markupaiIssueType = "grammar";
  diag.markupaiCategory = "grammar";
  diag.markupaiSeverity = "medium";

  return Object.assign(diag, overrides);
}

describe("MarkupAICodeActionProvider", () => {
  const provider = new MarkupAICodeActionProvider();
  const mockToken = {} as vscode.CancellationToken;

  it("should have QuickFix as provided code action kind", () => {
    expect(MarkupAICodeActionProvider.providedCodeActionKinds).toContain(
      vscode.CodeActionKind.QuickFix,
    );
  });

  it("should create a fix action for MarkupAI diagnostics with suggestions", () => {
    const doc = createMockDocument();
    const diagnostic = createMarkupDiagnostic();
    const context = { diagnostics: [diagnostic] } as unknown as vscode.CodeActionContext;

    const actions = provider.provideCodeActions(doc, diagnostic.range, context, mockToken);

    expect(actions.length).toBeGreaterThanOrEqual(1);
    const fixAction = actions[0];
    expect(fixAction.title).toContain("Fix:");
    expect(fixAction.title).toContain("Hello");
    expect(fixAction.title).toContain("Hi");
    expect(fixAction.isPreferred).toBe(true);
    expect(fixAction.command?.command).toBe("markupai.applyFix");
  });

  it("should include the correct fix arguments", () => {
    const doc = createMockDocument();
    const diagnostic = createMarkupDiagnostic();
    const context = { diagnostics: [diagnostic] } as unknown as vscode.CodeActionContext;

    const actions = provider.provideCodeActions(doc, diagnostic.range, context, mockToken);
    const fixArgs = actions[0].command?.arguments?.[0] as {
      uri: string;
      range: { start: { line: number }; end: { line: number } };
      suggestion: string;
    };

    expect(fixArgs.uri).toBe(doc.uri.toString());
    expect(fixArgs.suggestion).toBe("Hi");
    expect(fixArgs.range.start.line).toBe(0);
    expect(fixArgs.range.end.line).toBe(0);
  });

  it("should add a disable category action when category is present", () => {
    const doc = createMockDocument();
    const diagnostic = createMarkupDiagnostic({ markupaiCategory: "grammar" });
    const context = { diagnostics: [diagnostic] } as unknown as vscode.CodeActionContext;

    const actions = provider.provideCodeActions(doc, diagnostic.range, context, mockToken);

    expect(actions.length).toBe(2);
    const disableAction = actions[1];
    expect(disableAction.title).toBe("Disable Grammar Issues");
    expect(disableAction.command?.command).toBe("markupai.disableCategory");
    expect(disableAction.command?.arguments).toContain("grammar");
  });

  it("should not add disable category action when category is empty", () => {
    const doc = createMockDocument();
    const diagnostic = createMarkupDiagnostic({ markupaiCategory: "" });
    const context = { diagnostics: [diagnostic] } as unknown as vscode.CodeActionContext;

    const actions = provider.provideCodeActions(doc, diagnostic.range, context, mockToken);

    expect(actions.length).toBe(1);
  });

  it("should skip non-MarkupAI diagnostics", () => {
    const doc = createMockDocument();
    const range = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 5));
    const otherDiag = new vscode.Diagnostic(range, "Other issue", vscode.DiagnosticSeverity.Error);
    otherDiag.source = "OtherLinter";

    const context = { diagnostics: [otherDiag] } as unknown as vscode.CodeActionContext;

    const actions = provider.provideCodeActions(doc, range, context, mockToken);

    expect(actions).toHaveLength(0);
  });

  it("should skip diagnostics where suggestion equals original text", () => {
    const doc = createMockDocument();
    const diagnostic = createMarkupDiagnostic({
      markupaiSuggestion: "Hello",
      markupaiOriginalText: "Hello",
    });
    const context = { diagnostics: [diagnostic] } as unknown as vscode.CodeActionContext;

    const actions = provider.provideCodeActions(doc, diagnostic.range, context, mockToken);

    expect(actions).toHaveLength(0);
  });

  it("should skip diagnostics with empty suggestion", () => {
    const doc = createMockDocument();
    const diagnostic = createMarkupDiagnostic({ markupaiSuggestion: "" });
    const context = { diagnostics: [diagnostic] } as unknown as vscode.CodeActionContext;

    const actions = provider.provideCodeActions(doc, diagnostic.range, context, mockToken);

    expect(actions).toHaveLength(0);
  });

  it("should handle multiple diagnostics in context", () => {
    const doc = createMockDocument();
    const diag1 = createMarkupDiagnostic({
      markupaiSuggestion: "Hi",
      markupaiOriginalText: "Hello",
      markupaiCategory: "",
    });
    const diag2 = createMarkupDiagnostic({
      markupaiSuggestion: "earth",
      markupaiOriginalText: "world",
      markupaiCategory: "",
    });
    const context = { diagnostics: [diag1, diag2] } as unknown as vscode.CodeActionContext;

    const actions = provider.provideCodeActions(doc, diag1.range, context, mockToken);

    expect(actions.length).toBe(2);
  });
});
