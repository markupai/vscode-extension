import * as vscode from "vscode";
import { OffsetTranslator, TextOffsetMapper } from "./offsetMapper";
import { ContentIssue, ContentScores, MarkupAIDiagnostic } from "./types";
import { indexToPosition, getSeverityForIssue } from "./utils";

/**
 * Manages diagnostics, document issues, scores, and category filtering.
 */
export class DiagnosticsManager {
  private readonly diagnosticCollection: vscode.DiagnosticCollection;
  private readonly documentIssues: Map<string, ContentIssue[]> = new Map();
  private readonly documentScores: Map<string, ContentScores> = new Map();
  private readonly disabledCategories: Set<string> = new Set();

  constructor(diagnosticCollection: vscode.DiagnosticCollection) {
    this.diagnosticCollection = diagnosticCollection;
  }

  getDiagnosticCollection(): vscode.DiagnosticCollection {
    return this.diagnosticCollection;
  }

  getDiagnosticsForUri(uri: vscode.Uri): readonly vscode.Diagnostic[] | undefined {
    return this.diagnosticCollection.get(uri);
  }

  getIssues(docKey: string): ContentIssue[] | undefined {
    return this.documentIssues.get(docKey);
  }

  getAllIssues(): Map<string, ContentIssue[]> {
    return this.documentIssues;
  }

  setIssues(docKey: string, issues: ContentIssue[]): void {
    this.documentIssues.set(docKey, issues);
  }

  getScores(docKey: string): ContentScores | undefined {
    return this.documentScores.get(docKey);
  }

  setScores(docKey: string, scores: ContentScores): void {
    this.documentScores.set(docKey, scores);
  }

  getDisabledCategories(): Set<string> {
    return this.disabledCategories;
  }

  addDisabledCategory(category: string): void {
    this.disabledCategories.add(category.toLowerCase());
  }

  removeDisabledCategory(category: string): boolean {
    return this.disabledCategories.delete(category.toLowerCase());
  }

  updateDiagnostics(
    document: vscode.TextDocument,
    issues: ContentIssue[],
    originalText?: string,
  ): void {
    const diagnostics: vscode.Diagnostic[] = [];
    const currentText = document.getText();
    const docKey = document.uri.toString();

    const documentChanged = originalText !== undefined && originalText !== currentText;

    let offsetTranslator: OffsetTranslator | null = null;
    if (documentChanged) {
      offsetTranslator = new OffsetTranslator(originalText, currentText);
    }

    const currentTextMapper = documentChanged ? new TextOffsetMapper(currentText) : null;
    const adjustedIssues: ContentIssue[] = [];

    for (const issue of issues) {
      if (issue.category && this.disabledCategories.has(issue.category.toLowerCase())) {
        continue;
      }

      let startIndex = issue.startIndex;
      let endIndex = issue.endIndex;

      if (documentChanged && offsetTranslator) {
        const adjusted = this.resolveAdjustedOffsets(
          issue,
          offsetTranslator,
          currentTextMapper,
          currentText,
        );
        if (!adjusted) {
          continue;
        }
        startIndex = adjusted.startIndex;
        endIndex = adjusted.endIndex;
      }

      adjustedIssues.push({ ...issue, startIndex, endIndex });
      diagnostics.push(this.createMarkupDiagnostic(document, issue, startIndex, endIndex));
    }

    if (documentChanged) {
      this.documentIssues.set(docKey, adjustedIssues);
    }

    this.diagnosticCollection.set(document.uri, diagnostics);
  }

  private resolveAdjustedOffsets(
    issue: ContentIssue,
    offsetTranslator: OffsetTranslator,
    currentTextMapper: TextOffsetMapper | null,
    currentText: string,
  ): { startIndex: number; endIndex: number } | null {
    const translatedRange = offsetTranslator.translateRange(issue.startIndex, issue.endIndex);

    if (translatedRange) {
      if (
        OffsetTranslator.verifyTextAtPosition(
          issue.originalText,
          currentText,
          translatedRange.start,
        )
      ) {
        return { startIndex: translatedRange.start, endIndex: translatedRange.end };
      }
      return this.findFallbackPosition(
        currentTextMapper,
        issue.originalText,
        translatedRange.start,
        100,
      );
    }

    return this.findFallbackPosition(currentTextMapper, issue.originalText, issue.startIndex, 200);
  }

  private findFallbackPosition(
    currentTextMapper: TextOffsetMapper | null,
    originalText: string | undefined,
    searchStart: number,
    searchRadius: number,
  ): { startIndex: number; endIndex: number } | null {
    if (!currentTextMapper || !originalText) {
      return null;
    }

    const position = currentTextMapper.findNearbyText(originalText, searchStart, searchRadius);
    if (!position) {
      return null;
    }

    return { startIndex: position.start, endIndex: position.end };
  }

  private createMarkupDiagnostic(
    document: vscode.TextDocument,
    issue: ContentIssue,
    startIndex: number,
    endIndex: number,
  ): MarkupAIDiagnostic {
    const startPos = indexToPosition(document, startIndex);
    const endPos = indexToPosition(document, endIndex);
    const range = new vscode.Range(startPos, endPos);

    const diagnostic = new vscode.Diagnostic(
      range,
      issue.message,
      getSeverityForIssue(issue),
    ) as MarkupAIDiagnostic;

    diagnostic.source = "MarkupAI";
    diagnostic.markupaiSuggestion = issue.suggestion;
    diagnostic.markupaiOriginalText = issue.originalText;
    diagnostic.markupaiIssueType = issue.type;
    diagnostic.markupaiCategory = issue.category ?? "";
    diagnostic.markupaiSubcategory = issue.subcategory;
    diagnostic.markupaiSeverity = issue.severity;

    return diagnostic;
  }

  filterDiagnosticsByDisabledCategories(): void {
    this.diagnosticCollection.forEach((uri, diagnostics) => {
      const filteredDiagnostics = diagnostics.filter((diagnostic) => {
        const markupDiagnostic = diagnostic as MarkupAIDiagnostic;
        const category = markupDiagnostic.markupaiCategory;
        if (category && this.disabledCategories.has(category.toLowerCase())) {
          return false;
        }
        return true;
      });
      this.diagnosticCollection.set(uri, filteredDiagnostics);
    });
  }

  clearForDocument(uri: vscode.Uri): void {
    this.diagnosticCollection.delete(uri);
    this.documentIssues.delete(uri.toString());
    this.documentScores.delete(uri.toString());
  }

  clearAll(): void {
    this.diagnosticCollection.clear();
    this.documentIssues.clear();
    this.documentScores.clear();
  }
}
