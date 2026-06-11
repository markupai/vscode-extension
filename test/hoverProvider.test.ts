import { describe, it, expect, vi } from "vitest";
import * as vscode from "vscode";
import { MarkupAIHoverProvider } from "../src/hoverProvider";
import { MarkupAIDiagnostic } from "../src/types";

function createMockDocument(uriPath: string = "/test/file.md") {
  const uri = vscode.Uri.file(uriPath);
  return {
    uri,
    getText: vi.fn(() => "Hello world"),
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
  diag.markupaiCategory = "Grammar";
  diag.markupaiGuidelineName = "Subject-verb agreement";
  diag.markupaiSeverity = "medium";

  return Object.assign(diag, overrides);
}

function getHoverMarkdown(hover: vscode.Hover | null): vscode.MarkdownString {
  expect(hover).not.toBeNull();
  const h = hover as vscode.Hover;
  return h.contents[0] as vscode.MarkdownString;
}

describe("MarkupAIHoverProvider", () => {
  const mockToken = {} as vscode.CancellationToken;

  it("should return null when no diagnostics exist", () => {
    const provider = new MarkupAIHoverProvider(() => undefined);
    const doc = createMockDocument();
    const position = new vscode.Position(0, 2);

    const hover = provider.provideHover(doc, position, mockToken);

    expect(hover).toBeNull();
  });

  it("should return null when no diagnostics match position", () => {
    const range = new vscode.Range(new vscode.Position(1, 0), new vscode.Position(1, 5));
    const diag = new vscode.Diagnostic(
      range,
      "Other line issue",
      vscode.DiagnosticSeverity.Warning,
    ) as MarkupAIDiagnostic;
    diag.markupaiSuggestion = "fix";
    diag.markupaiOriginalText = "other";
    diag.markupaiCategory = "grammar";
    diag.markupaiSeverity = "low";

    const provider = new MarkupAIHoverProvider(() => [diag]);
    const doc = createMockDocument();
    const position = new vscode.Position(5, 0);

    const hover = provider.provideHover(doc, position, mockToken);

    expect(hover).toBeNull();
  });

  it("should return hover when position matches a diagnostic", () => {
    const diagnostic = createMarkupDiagnostic();
    const provider = new MarkupAIHoverProvider(() => [diagnostic]);
    const doc = createMockDocument();
    const position = new vscode.Position(0, 2);

    const hover = provider.provideHover(doc, position, mockToken);

    expect(hover).not.toBeNull();
    expect(hover).toBeInstanceOf(vscode.Hover);
  });

  it("should include category header in hover content", () => {
    const diagnostic = createMarkupDiagnostic({ markupaiCategory: "Grammar" });
    const provider = new MarkupAIHoverProvider(() => [diagnostic]);
    const doc = createMockDocument();
    const position = new vscode.Position(0, 2);

    const hover = provider.provideHover(doc, position, mockToken);

    const markdown = getHoverMarkdown(hover);
    expect(markdown.value).toContain("### Grammar");
  });

  it("should include suggestion and Apply Fix link", () => {
    const diagnostic = createMarkupDiagnostic({
      markupaiSuggestion: "Hi",
      markupaiOriginalText: "Hello",
    });
    const provider = new MarkupAIHoverProvider(() => [diagnostic]);
    const doc = createMockDocument();
    const position = new vscode.Position(0, 2);

    const hover = provider.provideHover(doc, position, mockToken);
    const markdown = getHoverMarkdown(hover);

    expect(markdown.value).toContain("**Suggestion:** `Hi`");
    expect(markdown.value).toContain("Apply Fix");
    expect(markdown.value).toContain("command:markupai.applyFix");
  });

  it("should not include suggestion when suggestion equals original text", () => {
    const diagnostic = createMarkupDiagnostic({
      markupaiSuggestion: "Hello",
      markupaiOriginalText: "Hello",
    });
    const provider = new MarkupAIHoverProvider(() => [diagnostic]);
    const doc = createMockDocument();
    const position = new vscode.Position(0, 2);

    const hover = provider.provideHover(doc, position, mockToken);
    const markdown = getHoverMarkdown(hover);

    expect(markdown.value).not.toContain("**Suggestion:**");
    expect(markdown.value).not.toContain("Apply Fix");
  });

  it("should include guideline when present", () => {
    const diagnostic = createMarkupDiagnostic({
      markupaiGuidelineName: "Subject-verb agreement",
    });
    const provider = new MarkupAIHoverProvider(() => [diagnostic]);
    const doc = createMockDocument();
    const position = new vscode.Position(0, 2);

    const hover = provider.provideHover(doc, position, mockToken);
    const markdown = getHoverMarkdown(hover);

    expect(markdown.value).toContain("**Guideline:** Subject-verb agreement");
  });

  it("should not include guideline when absent", () => {
    const diagnostic = createMarkupDiagnostic({ markupaiGuidelineName: undefined });
    const provider = new MarkupAIHoverProvider(() => [diagnostic]);
    const doc = createMockDocument();
    const position = new vscode.Position(0, 2);

    const hover = provider.provideHover(doc, position, mockToken);
    const markdown = getHoverMarkdown(hover);

    expect(markdown.value).not.toContain("**Guideline:**");
  });

  it("should not repeat guideline when it matches the category", () => {
    const diagnostic = createMarkupDiagnostic({
      markupaiCategory: "Grammar",
      markupaiGuidelineName: "Grammar",
    });
    const provider = new MarkupAIHoverProvider(() => [diagnostic]);
    const doc = createMockDocument();
    const position = new vscode.Position(0, 2);

    const hover = provider.provideHover(doc, position, mockToken);
    const markdown = getHoverMarkdown(hover);

    expect(markdown.value).not.toContain("**Guideline:**");
  });

  it("should show red emoji for high severity", () => {
    const diagnostic = createMarkupDiagnostic({ markupaiSeverity: "high" });
    const provider = new MarkupAIHoverProvider(() => [diagnostic]);
    const doc = createMockDocument();
    const position = new vscode.Position(0, 2);

    const hover = provider.provideHover(doc, position, mockToken);
    const markdown = getHoverMarkdown(hover);

    expect(markdown.value).toContain("🔴");
    expect(markdown.value).toContain("High");
  });

  it("should show yellow emoji for medium severity", () => {
    const diagnostic = createMarkupDiagnostic({ markupaiSeverity: "medium" });
    const provider = new MarkupAIHoverProvider(() => [diagnostic]);
    const doc = createMockDocument();
    const position = new vscode.Position(0, 2);

    const hover = provider.provideHover(doc, position, mockToken);
    const markdown = getHoverMarkdown(hover);

    expect(markdown.value).toContain("🟡");
    expect(markdown.value).toContain("Medium");
  });

  it("should show blue emoji for low severity", () => {
    const diagnostic = createMarkupDiagnostic({ markupaiSeverity: "low" });
    const provider = new MarkupAIHoverProvider(() => [diagnostic]);
    const doc = createMockDocument();
    const position = new vscode.Position(0, 2);

    const hover = provider.provideHover(doc, position, mockToken);
    const markdown = getHoverMarkdown(hover);

    expect(markdown.value).toContain("🔵");
    expect(markdown.value).toContain("Low");
  });

  it("should restrict trust to markupai.applyFix command only", () => {
    const diagnostic = createMarkupDiagnostic();
    const provider = new MarkupAIHoverProvider(() => [diagnostic]);
    const doc = createMockDocument();
    const position = new vscode.Position(0, 2);

    const hover = provider.provideHover(doc, position, mockToken);
    const markdown = getHoverMarkdown(hover);

    expect(markdown.isTrusted).toEqual({ enabledCommands: ["markupai.applyFix"] });
    expect(markdown.supportHtml).toBeUndefined();
  });

  it("should return hover for the first matching diagnostic", () => {
    const diag1 = createMarkupDiagnostic({ markupaiCategory: "Grammar" });
    const diag2Range = new vscode.Range(new vscode.Position(0, 3), new vscode.Position(0, 8));
    const diag2 = new vscode.Diagnostic(
      diag2Range,
      "Second issue",
      vscode.DiagnosticSeverity.Warning,
    ) as MarkupAIDiagnostic;
    diag2.markupaiSuggestion = "fixed";
    diag2.markupaiOriginalText = "lo wo";
    diag2.markupaiCategory = "Consistency";
    diag2.markupaiSeverity = "low";

    const provider = new MarkupAIHoverProvider(() => [diag1, diag2]);
    const doc = createMockDocument();
    const position = new vscode.Position(0, 2);

    const hover = provider.provideHover(doc, position, mockToken);
    const markdown = getHoverMarkdown(hover);

    expect(markdown.value).toContain("Grammar");
  });
});
