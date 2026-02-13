import * as vscode from "vscode";

// ============================================================================
// Content Issue Types
// ============================================================================

export interface ContentIssue {
  id: string;
  startIndex: number;
  endIndex: number;
  type: "spelling" | "grammar" | "consistency" | "clarity" | "terminology" | "tone";
  category?: string;
  subcategory?: string;
  message: string;
  suggestion: string;
  originalText: string;
  severity: "high" | "medium" | "low";
}

export interface ContentScores {
  overall: number;
  grammar: number;
  consistency: number;
  terminology: number;
}

export interface CheckResult {
  issues: ContentIssue[];
  scores: ContentScores;
}

// ============================================================================
// Style Guide Types
// ============================================================================

export interface StyleGuideOption {
  id: string;
  name: string;
  isBuiltIn: boolean;
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
  markupaiIssueType: string;
  markupaiCategory: string;
  markupaiSubcategory?: string;
  markupaiSeverity: string;
}
