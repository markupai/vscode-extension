import * as vscode from "vscode";

// ============================================================================
// Content Issue Types
// ============================================================================

export type IssueSeverity = "high" | "medium" | "low";

export interface ContentIssue {
  id: string;
  startIndex: number;
  endIndex: number;
  /** Free-form category from the Style Agent (e.g. "Spelling and Grammar"). */
  category: string;
  guidelineName?: string;
  message: string;
  /** Empty string when the issue has no replacement suggestion. */
  suggestion: string;
  originalText: string;
  severity: IssueSeverity;
}

/** Issue counts by risk level — the primary signal for organizations
 *  without numeric scoring. */
export interface RiskSummary {
  high: number;
  medium: number;
  low: number;
  total: number;
}

export interface DocumentAssessment {
  risk: RiskSummary;
  /** Numeric quality score (0–100); only present when the organization
   *  has numeric scoring enabled. */
  score?: number;
}

export interface CheckResult {
  issues: ContentIssue[];
  assessment: DocumentAssessment;
}

// ============================================================================
// Style Guide Types
// ============================================================================

export interface StyleGuideOption {
  id: string;
  name: string;
  isDefault: boolean;
  language?: string;
}

// ============================================================================
// Tree View Types
// ============================================================================

export interface FindingTreeItem {
  type: "file" | "issue";
  uri?: vscode.Uri;
  issue?: ContentIssue;
  label: string;
  children?: FindingTreeItem[];
}

export interface FolderScannerItem {
  type: "folder" | "file";
  uri: vscode.Uri;
  label: string;
  isSelected: boolean;
  children?: FolderScannerItem[];
}

// ============================================================================
// Diagnostic Extension Types
// ============================================================================

// Extended diagnostic interface for MarkupAI-specific properties
export interface MarkupAIDiagnostic extends vscode.Diagnostic {
  markupaiSuggestion: string;
  markupaiOriginalText: string;
  markupaiCategory: string;
  markupaiGuidelineName?: string;
  markupaiSeverity: string;
}
