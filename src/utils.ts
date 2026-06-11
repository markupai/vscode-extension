import * as vscode from "vscode";
import { MarkupAI } from "@markupai/api";
import { ContentIssue } from "./types";

export const SUPPORTED_SCHEMES = [
  "file",
  "untitled",
  "vscode-vfs",
  "github",
  "vscode-remote",
] as const;

const SUPPORTED_SCHEMES_SET = new Set<string>(SUPPORTED_SCHEMES);

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
  return getConfig().get("dialect", "american_english");
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
 * Whether the extension is running in a web (browser) extension host.
 */
export function isWebEnvironment(): boolean {
  return vscode.env.uiKind === vscode.UIKind.Web;
}

/**
 * Whether the given URI scheme is supported for content checking.
 */
export function isSupportedScheme(scheme: string): boolean {
  return SUPPORTED_SCHEMES_SET.has(scheme);
}

/**
 * Detect CORS / network errors that occur when the API server
 * does not return proper Access-Control-Allow-* headers.
 */
export function isCorsOrNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const msg = error.message.toLowerCase();
  return (
    msg.includes("failed to fetch") ||
    msg.includes("networkerror") ||
    msg.includes("network request failed") ||
    msg.includes("cors") ||
    msg.includes("load failed")
  );
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
