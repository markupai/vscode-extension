import * as vscode from "vscode";
import { MarkupAI } from "@markupai/api";
import { ContentIssue } from "./types";

/**
 * Get the MarkupAI configuration
 */
export function getConfig(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration("markupai");
}

/**
 * Get the API token from configuration
 */
export function getApiToken(): string {
  return getConfig().get("apiToken", "");
}

/**
 * Check if API token is configured
 */
export function hasApiToken(): boolean {
  return getApiToken().trim().length > 0;
}

/**
 * Get the selected dialect
 */
export function getDialect(): MarkupAI.Dialects {
  return getConfig().get("dialect", "american_english") as MarkupAI.Dialects;
}

/**
 * Get the selected style guide
 */
export function getStyleGuide(): string {
  return getConfig().get("styleGuide", "ap");
}

/**
 * Convert a character index to a VS Code Position
 */
export function indexToPosition(document: vscode.TextDocument, index: number): vscode.Position {
  return document.positionAt(index);
}

/**
 * Get the diagnostic severity for an issue
 */
export function getSeverityForIssue(issue: ContentIssue): vscode.DiagnosticSeverity {
  switch (issue.severity) {
    case "high":
      return vscode.DiagnosticSeverity.Error;
    case "medium":
      return vscode.DiagnosticSeverity.Warning;
    case "low":
      return vscode.DiagnosticSeverity.Information;
    default:
      return vscode.DiagnosticSeverity.Warning;
  }
}

/**
 * Get emoji for a quality score
 */
export function getScoreEmoji(score: number): string {
  if (score >= 90) {
    return "🟢";
  }
  if (score >= 70) {
    return "🟡";
  }
  if (score >= 50) {
    return "🟠";
  }
  return "🔴";
}

/**
 * Get emoji for an issue type
 */
export function getTypeEmoji(type: ContentIssue["type"]): string {
  switch (type) {
    case "grammar":
      return "📖";
    case "spelling":
      return "📝";
    case "consistency":
      return "🔄";
    case "clarity":
      return "💡";
    case "terminology":
      return "📚";
    case "tone":
      return "🎭";
    default:
      return "📝";
  }
}
