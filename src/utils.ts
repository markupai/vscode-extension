import * as vscode from "vscode";
import { ContentIssue, RiskSummary } from "./types";
import {
  CONSOLE_URLS,
  ENVIRONMENT_URLS,
  MarkupAIEnvironment,
  SIGNUP_UTM_PARAMS,
} from "./constants";

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
  return vscode.workspace.getConfiguration("markupai-lint");
}

/**
 * API environment. Production for everyone; `dev` is a development-only
 * override, enabled by launching the extension host with `MARKUPAI_ENV=dev`.
 * It is intentionally NOT a user-facing setting. The `typeof process` guard
 * keeps this safe in the web (browser) extension host, where `process` is
 * undefined.
 */
export function getEnvironment(): MarkupAIEnvironment {
  const override = typeof process === "undefined" ? undefined : process.env.MARKUPAI_ENV;
  return override === "dev" ? "dev" : "prod";
}

/**
 * Base URL of the MarkupAI API for the selected environment.
 */
export function getApiBaseUrl(): string {
  return ENVIRONMENT_URLS[getEnvironment()];
}

/**
 * Console signup URL, tagged for signup attribution. The Console `/signup`
 * route threads `utm_*` params through the Auth0 round-trip, so signups
 * started here are attributed to this extension (HubSpot + backend).
 */
export function getConsoleSignupUrl(): string {
  return `${CONSOLE_URLS[getEnvironment()]}/signup?${SIGNUP_UTM_PARAMS}`;
}

/** Values the pre-style-agent extension stored; not valid style guide IDs. */
const LEGACY_STYLE_GUIDE_IDS = new Set(["ap", "chicago", "microsoft"]);

/**
 * Selected style guide ID; empty string means the organization default.
 */
export function getStyleGuideId(): string {
  const value = getConfig().get("styleGuide", "");
  return LEGACY_STYLE_GUIDE_IDS.has(value) ? "" : value;
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
 * Highest severity present in a risk summary.
 */
export function getLeadSeverity(risk: RiskSummary): ContentIssue["severity"] {
  if (risk.high > 0) {
    return "high";
  }
  if (risk.medium > 0) {
    return "medium";
  }
  return "low";
}

/**
 * Get emoji for an issue severity
 */
export function getSeverityEmoji(severity: ContentIssue["severity"]): string {
  switch (severity) {
    case "high":
      return "🔴";
    case "medium":
      return "🟡";
    default:
      return "🔵";
  }
}

/**
 * Compact risk summary, e.g. "2H 3M 11L" or "No issues".
 */
export function formatRiskSummary(risk: RiskSummary): string {
  if (risk.total === 0) {
    return "No issues";
  }
  const parts: string[] = [];
  if (risk.high > 0) {
    parts.push(`${String(risk.high)}H`);
  }
  if (risk.medium > 0) {
    parts.push(`${String(risk.medium)}M`);
  }
  if (risk.low > 0) {
    parts.push(`${String(risk.low)}L`);
  }
  return parts.join(" ");
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
