import * as vscode from "vscode";
import { MarkupAIClient, MarkupAI } from "@markupai/api";
import { DiffMatchPatch, Diff, DiffOp } from "diff-match-patch-ts";

// ============================================================================
// Types and Interfaces
// ============================================================================

interface ContentIssue {
  id: string;
  startIndex: number;
  endIndex: number;
  type:
    | "spelling"
    | "grammar"
    | "consistency"
    | "clarity"
    | "terminology"
    | "tone";
  category?: string;
  subcategory?: string;
  message: string;
  suggestion: string;
  originalText: string;
  severity: "high" | "medium" | "low";
}

interface ContentScores {
  overall: number;
  grammar: number;
  consistency: number;
  terminology: number;
}

interface CheckResult {
  issues: ContentIssue[];
  scores: ContentScores;
}

interface StyleGuideOption {
  id: string;
  name: string;
  isBuiltIn: boolean;
}

// ============================================================================
// Constants
// ============================================================================

const DIALECTS: { value: MarkupAI.Dialects; label: string }[] = [
  { value: "american_english", label: "American English" },
  { value: "british_english", label: "British English" },
  { value: "canadian_english", label: "Canadian English" },
];

const BUILT_IN_STYLE_GUIDES: StyleGuideOption[] = [
  { id: "ap", name: "AP Style Guide", isBuiltIn: true },
  { id: "chicago", name: "Chicago Manual of Style", isBuiltIn: true },
  { id: "microsoft", name: "Microsoft Style Guide", isBuiltIn: true },
];

const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 60; // 2 minutes max

// ============================================================================
// Offset Translator - Uses diff-match-patch to map positions between text versions
// ============================================================================

/**
 * Translates character positions from an old version of text to a new version
 * using the diff-match-patch algorithm. This handles insertions, deletions,
 * and modifications accurately.
 */
class OffsetTranslator {
  private diffs: Diff[];
  private dmp: DiffMatchPatch;

  constructor(oldText: string, newText: string) {
    this.dmp = new DiffMatchPatch();
    this.diffs = this.dmp.diff_main(oldText, newText);
    // Cleanup for efficiency
    this.dmp.diff_cleanupEfficiency(this.diffs);
  }

  /**
   * Translate a position from the old text to the corresponding position in the new text.
   * Uses diff_xIndex internally which computes the equivalent location.
   * 
   * @param oldPosition - Character index in the old text
   * @returns The corresponding character index in the new text
   */
  translatePosition(oldPosition: number): number {
    return this.diff_xIndex(this.diffs, oldPosition);
  }

  /**
   * Translate a range (start, end) from old text to new text positions.
   * 
   * @param startIndex - Start position in old text
   * @param endIndex - End position in old text
   * @returns Object with translated start and end positions, or null if the range was deleted
   */
  translateRange(startIndex: number, endIndex: number): { start: number; end: number } | null {
    const newStart = this.translatePosition(startIndex);
    const newEnd = this.translatePosition(endIndex);
    
    // If start >= end after translation, the content was deleted
    if (newStart >= newEnd) {
      return null;
    }
    
    return { start: newStart, end: newEnd };
  }

  /**
   * Implementation of diff_xIndex - maps a character position in text1 to 
   * the equivalent position in text2 based on the diff array.
   * 
   * This is based on the Google diff-match-patch algorithm.
   * 
   * @param diffs - Array of diff tuples
   * @param loc - Location in text1 to translate
   * @returns Location in text2
   */
  private diff_xIndex(diffs: Diff[], loc: number): number {
    let chars1 = 0;
    let chars2 = 0;
    let lastChars1 = 0;
    let lastChars2 = 0;

    for (const diff of diffs) {
      const op = diff[0];
      const text = diff[1];

      if (op !== DiffOp.Insert) {
        // Equality or deletion - advances position in text1
        chars1 += text.length;
      }
      if (op !== DiffOp.Delete) {
        // Equality or insertion - advances position in text2
        chars2 += text.length;
      }

      if (chars1 > loc) {
        // Overshot the location
        break;
      }
      lastChars1 = chars1;
      lastChars2 = chars2;
    }

    // If the location was deleted, return the position where deletion started in text2
    // Otherwise, add the remaining characters
    if (diffs.length > 0) {
      const lastDiff = diffs[diffs.length - 1];
      if (lastDiff && chars1 === loc && lastDiff[0] === DiffOp.Delete) {
        // The location is at a deletion point
        return lastChars2;
      }
    }

    return lastChars2 + (loc - lastChars1);
  }

  /**
   * Check if a specific text still exists at the translated position in the new text.
   * 
   * @param originalText - The text that should be at the position
   * @param newText - The new document text
   * @param translatedStart - The translated start position
   * @returns true if the text matches at the translated position
   */
  static verifyTextAtPosition(originalText: string, newText: string, translatedStart: number): boolean {
    if (translatedStart < 0 || translatedStart + originalText.length > newText.length) {
      return false;
    }
    return newText.substring(translatedStart, translatedStart + originalText.length) === originalText;
  }
}

// ============================================================================
// Text Offset Mapper - Handles Unicode encoding differences
// ============================================================================

/**
 * Maps between different text offset types:
 * - Unicode code points (what many APIs return)
 * - UTF-8 byte offsets (file-based APIs)
 * - UTF-16 code units (JavaScript string indices)
 * 
 * Emojis and characters outside BMP cause differences:
 * - 😀 (U+1F600): 1 code point, 4 UTF-8 bytes, 2 UTF-16 code units
 */
class TextOffsetMapper {
  private text: string;
  private codePointToStringIndex: number[] = [];
  private byteToStringIndex: number[] = [];

  constructor(text: string) {
    this.text = text;
    this.buildMappings();
  }

  private buildMappings(): void {
    const encoder = new TextEncoder();
    let stringIndex = 0;
    let byteOffset = 0;
    let codePointIndex = 0;

    // Build code point to string index mapping
    this.codePointToStringIndex.push(0);
    this.byteToStringIndex.push(0);

    for (const char of this.text) {
      // Each iteration gives us one code point (handles surrogate pairs)
      const charLength = char.length; // 1 for BMP, 2 for surrogate pairs
      const charBytes = encoder.encode(char).length;

      stringIndex += charLength;
      byteOffset += charBytes;
      codePointIndex++;

      this.codePointToStringIndex.push(stringIndex);
      
      // Fill in byte offsets for each byte
      for (let i = 1; i <= charBytes; i++) {
        this.byteToStringIndex.push(stringIndex);
      }
    }
  }

  /**
   * Convert a Unicode code point offset to a JavaScript string index.
   * Use this if the API counts characters as code points.
   */
  codePointOffsetToStringIndex(codePointOffset: number): number {
    if (codePointOffset < 0) { return 0; }
    if (codePointOffset >= this.codePointToStringIndex.length) {
      return this.text.length;
    }
    return this.codePointToStringIndex[codePointOffset];
  }

  /**
   * Convert a UTF-8 byte offset to a JavaScript string index.
   * Use this if the API counts positions as byte offsets.
   */
  byteOffsetToStringIndex(byteOffset: number): number {
    if (byteOffset < 0) { return 0; }
    if (byteOffset >= this.byteToStringIndex.length) {
      return this.text.length;
    }
    return this.byteToStringIndex[byteOffset];
  }

  /**
   * Find the actual position of text in the string, searching from a start index.
   * Returns the start and end string indices.
   */
  findTextPosition(searchText: string, startFromIndex: number): { start: number; end: number } | null {
    const foundIndex = this.text.indexOf(searchText, startFromIndex);
    if (foundIndex === -1) { return null; }
    return {
      start: foundIndex,
      end: foundIndex + searchText.length
    };
  }

  /**
   * Given an approximate start index and the original text, find the exact position.
   * This is useful when the offset might be slightly off due to encoding differences
   * or when the document has changed during an async operation.
   */
  findNearbyText(searchText: string, approximateIndex: number, searchRadius: number = 20): { start: number; end: number } | null {
    // Try exact position first
    const exactStart = Math.max(0, approximateIndex);
    if (this.text.substring(exactStart, exactStart + searchText.length) === searchText) {
      return { start: exactStart, end: exactStart + searchText.length };
    }

    // Search nearby with the given radius
    const searchStart = Math.max(0, approximateIndex - searchRadius);
    const searchEnd = Math.min(this.text.length, approximateIndex + searchRadius + searchText.length);
    const searchArea = this.text.substring(searchStart, searchEnd);
    
    const foundInArea = searchArea.indexOf(searchText);
    if (foundInArea !== -1) {
      const actualStart = searchStart + foundInArea;
      return { start: actualStart, end: actualStart + searchText.length };
    }

    // If not found nearby, search the entire document as a fallback
    // This handles cases where text moved significantly due to edits
    const globalIndex = this.text.indexOf(searchText);
    if (globalIndex !== -1) {
      return { start: globalIndex, end: globalIndex + searchText.length };
    }

    return null;
  }
}

// ============================================================================
// MarkupAI API Client
// ============================================================================

class MarkupAIContentChecker {
  private client: MarkupAIClient;
  private originalText: string = "";
  private offsetMapper: TextOffsetMapper | null = null;

  constructor(apiToken: string) {
    this.client = new MarkupAIClient({
      token: apiToken,
    });
  }

  async fetchStyleGuides(): Promise<StyleGuideOption[]> {
    try {
      const styleGuides = await this.client.styleGuides.listStyleGuides();
      
      // Known built-in style guide names (case-insensitive matching)
      const builtInNames = new Set([
        "ap style guide", "ap", "associated press",
        "chicago manual of style", "chicago", "cmos",
        "microsoft style guide", "microsoft", "microsoft writing style guide"
      ]);
      
      const customGuides: StyleGuideOption[] = [];
      const builtInGuides: StyleGuideOption[] = [];
      
      for (const guide of styleGuides) {
        const nameLower = guide.name.toLowerCase();
        const idLower = guide.id.toLowerCase();
        
        // Check if this is a built-in style guide by name or ID
        const isBuiltIn = builtInNames.has(nameLower) || 
                          builtInNames.has(idLower) ||
                          nameLower.includes("ap style") ||
                          nameLower.includes("chicago") ||
                          nameLower.includes("microsoft");
        
        const styleGuideOption: StyleGuideOption = {
          id: guide.id,
          name: guide.name,
          isBuiltIn: isBuiltIn,
        };
        
        if (isBuiltIn) {
          builtInGuides.push(styleGuideOption);
        } else {
          customGuides.push(styleGuideOption);
        }
      }
      
      // Custom/server guides at top, built-in guides at bottom
      return [...customGuides, ...builtInGuides];
    } catch (error) {
      console.error("MarkupAI: Error fetching style guides", error);
      return BUILT_IN_STYLE_GUIDES;
    }
  }

  async checkContent(
    text: string,
    dialect: MarkupAI.Dialects,
    styleGuide: string
  ): Promise<CheckResult> {
    // Store original text and create offset mapper for Unicode handling
    this.originalText = text;
    this.offsetMapper = new TextOffsetMapper(text);
    
    // Create a Blob from the text content
    const blob = new Blob([text], { type: "text/plain" });
    const file = new File([blob], "content.txt", { type: "text/plain" });

    // Create style suggestion request
    const workflowResponse =
      await this.client.styleSuggestions.createStyleSuggestion({
        file_upload: file,
        dialect: dialect,
        style_guide: styleGuide,
      });

    const workflowId = workflowResponse.workflow_id;

    // Poll for results
    const result = await this.pollForResults(workflowId);
    return result;
  }

  private async pollForResults(workflowId: string): Promise<CheckResult> {
    let attempts = 0;

    while (attempts < MAX_POLL_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      attempts++;

      try {
        const suggestionResponse =
          await this.client.styleSuggestions.getStyleSuggestion(workflowId);
        const status = suggestionResponse.workflow?.status;

        if (status === "completed") {
          return this.parseResponse(suggestionResponse);
        } else if (status === "failed") {
          throw new Error("MarkupAI: Content check failed");
        }
        // If still running, continue polling
      } catch (error: any) {
        if (error?.statusCode === 404) {
          // Workflow not found yet, continue polling
          continue;
        }
        throw error;
      }
    }

    throw new Error("MarkupAI: Content check timed out");
  }

  private parseResponse(response: MarkupAI.SuggestionResponse): CheckResult {
    const issues: ContentIssue[] = [];
    const apiIssues = response.original?.issues || [];

    for (let i = 0; i < apiIssues.length; i++) {
      const issue = apiIssues[i];
      const issueType = this.mapCategoryToType(issue.category);

      // Convert API offset to JavaScript string index
      // The API likely returns Unicode code point offsets, which differ from 
      // JavaScript's UTF-16 code unit indices for emojis and other non-BMP characters
      let startIndex: number;
      let endIndex: number;

      if (this.offsetMapper) {
        // First, try to convert the code point offset
        const convertedStart = this.offsetMapper.codePointOffsetToStringIndex(
          issue.position.start_index
        );
        
        // Then, verify by finding the actual text in the document
        // This handles any remaining edge cases and ensures accuracy
        const position = this.offsetMapper.findNearbyText(
          issue.original,
          convertedStart,
          50 // Search within 50 characters if not exact match
        );
        
        if (position) {
          startIndex = position.start;
          endIndex = position.end;
        } else {
          // Fallback: use the converted offset and calculate end from original length
          startIndex = convertedStart;
          endIndex = startIndex + issue.original.length;
        }
      } else {
        // No mapper available, use raw values (fallback)
        startIndex = issue.position.start_index;
        endIndex = issue.position.start_index + issue.original.length;
      }

      issues.push({
        id: `issue-${i}`,
        startIndex: startIndex,
        endIndex: endIndex,
        type: issueType,
        category: issue.category,
        subcategory:
          typeof issue.subcategory === "string" ? issue.subcategory : undefined,
        message:
          issue.explanation ||
          `${issue.category}: Replace "${issue.original}" with "${issue.suggestion}"`,
        suggestion: issue.suggestion,
        originalText: issue.original,
        severity: issue.severity,
      });
    }

    const qualityScore = response.original?.scores?.quality;
    const scores: ContentScores = {
      overall: qualityScore?.score ?? 100,
      grammar: qualityScore?.grammar?.score ?? 100,
      consistency: qualityScore?.consistency?.score ?? 100,
      terminology: qualityScore?.terminology?.score ?? 100,
    };

    return { issues, scores };
  }

  private mapCategoryToType(
    category?: MarkupAI.IssueCategory
  ): ContentIssue["type"] {
    switch (category) {
      case "grammar":
        return "grammar";
      case "clarity":
        return "clarity";
      case "consistency":
        return "consistency";
      case "terminology":
        return "terminology";
      case "tone":
        return "tone";
      default:
        return "grammar";
    }
  }
}

// ============================================================================
// Extension State
// ============================================================================

let diagnosticCollection: vscode.DiagnosticCollection;
let statusBarItem: vscode.StatusBarItem;
let documentIssues: Map<string, ContentIssue[]> = new Map();
let documentScores: Map<string, ContentScores> = new Map();
let checkDebounceTimers: Map<string, NodeJS.Timeout> = new Map();
let isEnabled = true;
let cachedStyleGuides: StyleGuideOption[] = [...BUILT_IN_STYLE_GUIDES];
let isCheckingDocument: Map<string, boolean> = new Map();
let isApplyingFix = false; // Flag to prevent re-checking when applying fixes
let disabledCategories: Set<string> = new Set(); // Categories that are disabled by user
let documentTextAtCheckStart: Map<string, string> = new Map(); // Store text when check started

// ============================================================================
// Utility Functions
// ============================================================================

function getConfig(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration("markupai");
}

function getApiToken(): string {
  return getConfig().get("apiToken", "");
}

function hasApiToken(): boolean {
  return getApiToken().trim().length > 0;
}

function isExtensionEnabled(): boolean {
  return isEnabled && getConfig().get("enabled", true);
}

function getDialect(): MarkupAI.Dialects {
  return getConfig().get("dialect", "american_english") as MarkupAI.Dialects;
}

function getStyleGuide(): string {
  return getConfig().get("styleGuide", "ap");
}

function indexToPosition(
  document: vscode.TextDocument,
  index: number
): vscode.Position {
  return document.positionAt(index);
}

function getSeverityForIssue(issue: ContentIssue): vscode.DiagnosticSeverity {
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

function getScoreEmoji(score: number): string {
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

function getTypeEmoji(type: ContentIssue["type"]): string {
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

// ============================================================================
// Core Functionality
// ============================================================================

async function checkDocument(
  document: vscode.TextDocument,
  showProgress: boolean = false,
  showCompletionNotification: boolean = true
): Promise<void> {
  if (!isExtensionEnabled()) {
    clearDiagnostics(document);
    updateStatusBar(null);
    return;
  }

  // Check if API token is configured
  if (!hasApiToken()) {
    updateStatusBarNoToken();
    return;
  }

  // Only check text-based documents
  if (document.uri.scheme !== "file" && document.uri.scheme !== "untitled") {
    return;
  }

  const text = document.getText();
  if (!text.trim()) {
    clearDiagnostics(document);
    updateStatusBar({
      grammar: 100,
      consistency: 100,
      terminology: 100,
      overall: 100,
    });
    return;
  }

  // Prevent concurrent checks on the same document
  const docKey = document.uri.toString();
  if (isCheckingDocument.get(docKey)) {
    return;
  }

  isCheckingDocument.set(docKey, true);
  updateStatusBarChecking();

  // Store the text at check start to detect changes during the check
  const textAtCheckStart = text;
  documentTextAtCheckStart.set(docKey, textAtCheckStart);

  try {
    const checker = new MarkupAIContentChecker(getApiToken());
    let result: CheckResult;

    if (showProgress) {
      result = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "MarkupAI: Checking content...",
          cancellable: false,
        },
        async () => {
          return await checker.checkContent(
            text,
            getDialect(),
            getStyleGuide()
          );
        }
      );
    } else {
      result = await checker.checkContent(text, getDialect(), getStyleGuide());
    }

    // Store issues and scores for this document
    documentIssues.set(docKey, result.issues);
    documentScores.set(docKey, result.scores);

    // Update diagnostics - pass the original text to handle document changes during check
    updateDiagnostics(document, result.issues, textAtCheckStart);

    // Update status bar
    updateStatusBar(result.scores);

    // Refresh findings panel
    if (findingsTreeDataProvider) {
      findingsTreeDataProvider.refresh();
    }

    // Show completion notification (unless suppressed for batch operations)
    if (showCompletionNotification) {
      showCheckCompleteNotification(result.scores, result.issues.length);
    }
  } catch (error: any) {
    console.error("MarkupAI: Error checking content", error);

    // Only show error notifications if not in batch mode
    if (showCompletionNotification) {
      if (error?.statusCode === 401) {
        vscode.window.showErrorMessage(
          "MarkupAI: Invalid API token. Please check your settings."
        );
        updateStatusBarNoToken();
      } else {
        vscode.window.showErrorMessage(
          `MarkupAI: Error checking content - ${
            error?.message || "Unknown error"
          }`
        );
        statusBarItem.text = "⚠️ MarkupAI: Error";
        statusBarItem.show();
      }
    } else {
      // In batch mode, rethrow the error so it can be caught and handled by checkMultipleFiles
      throw error;
    }
  } finally {
    isCheckingDocument.set(docKey, false);
    // Clean up stored text for this document
    documentTextAtCheckStart.delete(docKey);
  }
}

function updateDiagnostics(
  document: vscode.TextDocument,
  issues: ContentIssue[],
  originalText?: string
): void {
  const diagnostics: vscode.Diagnostic[] = [];
  const currentText = document.getText();
  const docKey = document.uri.toString();
  
  // Check if document changed during the check
  const documentChanged = originalText !== undefined && originalText !== currentText;
  
  // Create offset translator using diff-match-patch if document changed
  let offsetTranslator: OffsetTranslator | null = null;
  if (documentChanged) {
    offsetTranslator = new OffsetTranslator(originalText, currentText);
  }
  
  // Create a text mapper for fallback text search
  const currentTextMapper = documentChanged ? new TextOffsetMapper(currentText) : null;

  // Track adjusted issues to update the documentIssues map
  const adjustedIssues: ContentIssue[] = [];

  for (const issue of issues) {
    // Skip issues from disabled categories
    if (issue.category && disabledCategories.has(issue.category.toLowerCase())) {
      continue;
    }

    let startIndex = issue.startIndex;
    let endIndex = issue.endIndex;

    // If the document changed during the check, translate positions using diff algorithm
    if (documentChanged && offsetTranslator) {
      // Use diff-match-patch to translate the positions
      const translatedRange = offsetTranslator.translateRange(issue.startIndex, issue.endIndex);
      
      if (translatedRange) {
        startIndex = translatedRange.start;
        endIndex = translatedRange.end;
        
        // Verify that the original text still exists at the translated position
        if (!OffsetTranslator.verifyTextAtPosition(issue.originalText, currentText, startIndex)) {
          // Text doesn't match at translated position, try fallback text search
          if (currentTextMapper && issue.originalText) {
            const fallbackPosition = currentTextMapper.findNearbyText(
              issue.originalText,
              startIndex,
              100
            );
            
            if (fallbackPosition) {
              startIndex = fallbackPosition.start;
              endIndex = fallbackPosition.end;
            } else {
              // Text not found - skip this issue as it was likely edited
              continue;
            }
          } else {
            continue;
          }
        }
      } else {
        // Range was deleted (start >= end after translation)
        // Try fallback text search in case the text still exists elsewhere
        if (currentTextMapper && issue.originalText) {
          const fallbackPosition = currentTextMapper.findNearbyText(
            issue.originalText,
            issue.startIndex,
            200 // Wider search for deleted ranges
          );
          
          if (fallbackPosition) {
            startIndex = fallbackPosition.start;
            endIndex = fallbackPosition.end;
          } else {
            // Text truly not found - skip this issue
            continue;
          }
        } else {
          continue;
        }
      }
    }

    // Store adjusted issue for the findings panel
    const adjustedIssue: ContentIssue = {
      ...issue,
      startIndex,
      endIndex
    };
    adjustedIssues.push(adjustedIssue);

    const startPos = indexToPosition(document, startIndex);
    const endPos = indexToPosition(document, endIndex);
    const range = new vscode.Range(startPos, endPos);

    const diagnostic = new vscode.Diagnostic(
      range,
      issue.message,
      getSeverityForIssue(issue)
    );

    diagnostic.source = "MarkupAI";

    // Store additional data in the diagnostic
    (diagnostic as any).markupaiSuggestion = issue.suggestion;
    (diagnostic as any).markupaiOriginalText = issue.originalText;
    (diagnostic as any).markupaiIssueType = issue.type;
    (diagnostic as any).markupaiCategory = issue.category;
    (diagnostic as any).markupaiSubcategory = issue.subcategory;
    (diagnostic as any).markupaiSeverity = issue.severity;

    diagnostics.push(diagnostic);
  }

  // Update stored issues with adjusted positions for findings panel navigation
  if (documentChanged) {
    documentIssues.set(docKey, adjustedIssues);
  }

  diagnosticCollection.set(document.uri, diagnostics);
}

// Filter out diagnostics from disabled categories across all documents
function filterDiagnosticsByDisabledCategories(): void {
  diagnosticCollection.forEach((uri, diagnostics) => {
    const filteredDiagnostics = diagnostics.filter((diagnostic) => {
      const category = (diagnostic as any).markupaiCategory;
      if (category && disabledCategories.has(category.toLowerCase())) {
        return false;
      }
      return true;
    });
    diagnosticCollection.set(uri, filteredDiagnostics);
  });
}

function clearDiagnostics(document: vscode.TextDocument): void {
  diagnosticCollection.delete(document.uri);
  documentIssues.delete(document.uri.toString());
  documentScores.delete(document.uri.toString());
  if (findingsTreeDataProvider) {
    findingsTreeDataProvider.refresh();
  }
}

function clearAllDiagnostics(): void {
  diagnosticCollection.clear();
  documentIssues.clear();
  documentScores.clear();
  if (findingsTreeDataProvider) {
    findingsTreeDataProvider.refresh();
  }
}

async function setMarkupAIEnabled(enabled: boolean): Promise<void> {
  isEnabled = enabled;

  // Update the context variable for menu visibility
  await vscode.commands.executeCommand(
    "setContext",
    "markupai.enabled",
    isEnabled
  );

  // Persist the setting
  const config = getConfig();
  await config.update("enabled", isEnabled, vscode.ConfigurationTarget.Global);

  if (isEnabled) {
    vscode.window.showInformationMessage("MarkupAI: Issues Enabled");
    // Re-check the active document
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      checkDocument(editor.document, true);
    }
  } else {
    vscode.window.showInformationMessage("MarkupAI: Issues Disabled");
    clearAllDiagnostics();
    statusBarItem.text = "$(circle-slash) MarkupAI: Disabled";
    statusBarItem.tooltip =
      "MarkupAI issues are disabled. Right-click to enable.";
    statusBarItem.command = "markupai.enableIssues";
    statusBarItem.backgroundColor = undefined;
    statusBarItem.show();
  }
}

function updateStatusBar(scores: ContentScores | null): void {
  if (!scores) {
    statusBarItem.hide();
    return;
  }

  const emoji = getScoreEmoji(scores.overall);
  statusBarItem.text = `${emoji} MarkupAI: ${scores.overall}`;
  statusBarItem.tooltip = `Click to see detailed scores\n\nGrammar: ${scores.grammar}\nConsistency: ${scores.consistency}\nTerminology: ${scores.terminology}`;
  statusBarItem.command = "markupai.showScores";
  statusBarItem.backgroundColor = undefined;
  statusBarItem.show();
}

function updateStatusBarNoToken(): void {
  statusBarItem.text = "$(key) MarkupAI: Add API Token";
  statusBarItem.tooltip = "Click to configure your MarkupAI API token";
  statusBarItem.command = "markupai.configureApiToken";
  statusBarItem.backgroundColor = new vscode.ThemeColor(
    "statusBarItem.warningBackground"
  );
  statusBarItem.show();
}

function updateStatusBarChecking(): void {
  statusBarItem.text = "$(sync~spin) MarkupAI: Checking...";
  statusBarItem.tooltip = "Checking content...";
  statusBarItem.show();
}

async function showCheckCompleteNotification(scores: ContentScores, issueCount: number): Promise<void> {
  // Build a visually appealing notification message
  const scoreEmoji = getScoreEmoji(scores.overall);
  
  // Determine overall message based on score
  let statusMessage: string;
  if (scores.overall >= 90) {
    statusMessage = "Excellent!";
  } else if (scores.overall >= 70) {
    statusMessage = "Good";
  } else if (scores.overall >= 50) {
    statusMessage = "Needs Improvement";
  } else {
    statusMessage = "Needs Attention";
  }

  const message = `${scoreEmoji} MarkupAI Check Complete — ${statusMessage} | ` +
    `Score: ${scores.overall} | ` +
    `${issueCount} issue${issueCount !== 1 ? 's' : ''} found`;

  const action = await vscode.window.showInformationMessage(
    message,
    "View Details",
    "Show Findings"
  );

  if (action === "View Details") {
    vscode.commands.executeCommand("markupai.showScores");
  } else if (action === "Show Findings") {
    vscode.commands.executeCommand("markupai.findings.focus");
  }
}

function scheduleCheck(document: vscode.TextDocument): void {
  const uri = document.uri.toString();

  // Clear existing timer
  const existingTimer = checkDebounceTimers.get(uri);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  // Schedule new check
  const delay = getConfig().get("checkDelay", 2000);
  const timer = setTimeout(() => {
    checkDocument(document);
    checkDebounceTimers.delete(uri);
  }, delay);

  checkDebounceTimers.set(uri, timer);
}

// ============================================================================
// Code Actions Provider (Quick Fixes)
// ============================================================================

class MarkupAICodeActionProvider implements vscode.CodeActionProvider {
  static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  provideCodeActions(
    document: vscode.TextDocument,
    _range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
    _token: vscode.CancellationToken
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];

    for (const diagnostic of context.diagnostics) {
      if (diagnostic.source !== "MarkupAI") {
        continue;
      }

      const suggestion = (diagnostic as any).markupaiSuggestion;
      const originalText = (diagnostic as any).markupaiOriginalText;
      const category = (diagnostic as any).markupaiCategory;

      if (suggestion && suggestion !== originalText) {
        // Create quick fix action using applyFix command to handle overlapping issues
        const action = new vscode.CodeAction(
          `Fix: Replace "${originalText}" with "${suggestion}"`,
          vscode.CodeActionKind.QuickFix
        );

        action.command = {
          command: "markupai.applyFix",
          title: "Apply Fix",
          arguments: [
            {
              uri: document.uri.toString(),
              range: {
                start: {
                  line: diagnostic.range.start.line,
                  character: diagnostic.range.start.character,
                },
                end: {
                  line: diagnostic.range.end.line,
                  character: diagnostic.range.end.character,
                },
              },
              suggestion: suggestion,
            },
          ],
        };
        action.diagnostics = [diagnostic];
        action.isPreferred = true;

        actions.push(action);

        // Add category-specific disable action
        if (category) {
          const categoryLabel = category.charAt(0).toUpperCase() + category.slice(1);
          const disableCategoryAction = new vscode.CodeAction(
            `Disable ${categoryLabel} Issues`,
            vscode.CodeActionKind.QuickFix
          );
          disableCategoryAction.command = {
            command: "markupai.disableCategory",
            title: `Disable ${categoryLabel} Issues`,
            arguments: [category],
          };
          actions.push(disableCategoryAction);
        }
      }
    }

    return actions;
  }
}

// ============================================================================
// Hover Provider
// ============================================================================

class MarkupAIHoverProvider implements vscode.HoverProvider {
  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken
  ): vscode.Hover | null {
    const diagnostics = diagnosticCollection.get(document.uri);
    if (!diagnostics) {
      return null;
    }

    for (const diagnostic of diagnostics) {
      if (diagnostic.range.contains(position)) {
        const suggestion = (diagnostic as any).markupaiSuggestion;
        const originalText = (diagnostic as any).markupaiOriginalText;
        const category = (diagnostic as any).markupaiCategory;
        const subcategory = (diagnostic as any).markupaiSubcategory;
        const severity = (diagnostic as any).markupaiSeverity;

        const markdown = new vscode.MarkdownString();
        markdown.isTrusted = true;
        markdown.supportHtml = true;

        // 1. Category on top
        if (category) {
          const categoryLabel =
            category.charAt(0).toUpperCase() + category.slice(1);
          const categoryEmoji = getTypeEmoji(category);
          markdown.appendMarkdown(`### ${categoryEmoji} ${categoryLabel}\n\n`);
        }

        // 2. Suggestion and Apply button immediately after category (visible without scrolling)
        if (suggestion && suggestion !== originalText) {
          markdown.appendMarkdown(`**Suggestion:** \`${suggestion}\`\n\n`);

          const args = encodeURIComponent(
            JSON.stringify({
              uri: document.uri.toString(),
              range: {
                start: {
                  line: diagnostic.range.start.line,
                  character: diagnostic.range.start.character,
                },
                end: {
                  line: diagnostic.range.end.line,
                  character: diagnostic.range.end.character,
                },
              },
              suggestion: suggestion,
            })
          );
          markdown.appendMarkdown(
            `[Apply Fix](command:markupai.applyFix?${args})\n\n`
          );
        }

        // 3. Subcategory
        if (subcategory) {
          const subcategoryLabel =
            subcategory.charAt(0).toUpperCase() + subcategory.slice(1);
          markdown.appendMarkdown(`**Subcategory:** ${subcategoryLabel}\n\n`);
        }

        // 4. Severity (colors match underline: high=red, medium=yellow, low=blue)
        if (severity) {
          const severityEmoji = severity === 'high' ? '🔴' : severity === 'medium' ? '🟡' : '🔵';
          const severityLabel = severity.charAt(0).toUpperCase() + severity.slice(1);
          markdown.appendMarkdown(`**Severity:** ${severityEmoji} ${severityLabel}\n\n`);
        }

        return new vscode.Hover(markdown, diagnostic.range);
      }
    }

    return null;
  }
}

// ============================================================================
// Commands
// ============================================================================

async function configureApiToken(): Promise<void> {
  const currentToken = getApiToken();
  const token = await vscode.window.showInputBox({
    prompt: "Enter your MarkupAI API token",
    password: true,
    value: currentToken,
    placeHolder: "Paste your API token here",
    ignoreFocusOut: true,
  });

  if (token !== undefined) {
    await getConfig().update(
      "apiToken",
      token,
      vscode.ConfigurationTarget.Global
    );

    if (token.trim()) {
      vscode.window.showInformationMessage("MarkupAI: API token saved");

      // Refresh style guides
      await refreshStyleGuides();

      // Re-check active document
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        checkDocument(editor.document, true);
      }
    } else {
      updateStatusBarNoToken();
    }
  }
}

async function refreshStyleGuides(): Promise<void> {
  if (!hasApiToken()) {
    cachedStyleGuides = [...BUILT_IN_STYLE_GUIDES];
    return;
  }

  try {
    const checker = new MarkupAIContentChecker(getApiToken());
    cachedStyleGuides = await checker.fetchStyleGuides();
  } catch (error) {
    console.error("MarkupAI: Error refreshing style guides", error);
    cachedStyleGuides = [...BUILT_IN_STYLE_GUIDES];
  }
}

async function selectStyleGuide(): Promise<void> {
  if (!hasApiToken()) {
    const action = await vscode.window.showWarningMessage(
      "MarkupAI: API token required to fetch style guides",
      "Configure Token"
    );
    if (action === "Configure Token") {
      await configureApiToken();
    }
    return;
  }

  // Refresh style guides before showing picker
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Loading style guides...",
      cancellable: false,
    },
    async () => {
      await refreshStyleGuides();
    }
  );

  const currentStyleGuide = getStyleGuide();
  const customGuides = cachedStyleGuides.filter((g) => !g.isBuiltIn);
  const builtInGuides = cachedStyleGuides.filter((g) => g.isBuiltIn);

  const items: vscode.QuickPickItem[] = [];

  // Add custom/server guides first
  if (customGuides.length > 0) {
    items.push({
      label: "Your Style Guides",
      kind: vscode.QuickPickItemKind.Separator,
    });
    for (const guide of customGuides) {
      items.push({
        label: guide.name,
        description: guide.id === currentStyleGuide ? "✓ Selected" : "",
        detail: guide.id,
      });
    }
  }

  // Add built-in guides at the bottom
  items.push({
    label: "Built-in Style Guides",
    kind: vscode.QuickPickItemKind.Separator,
  });
  for (const guide of builtInGuides) {
    items.push({
      label: guide.name,
      description: guide.id === currentStyleGuide ? "✓ Selected" : "",
      detail: guide.id,
    });
  }

  const selected = await vscode.window.showQuickPick(items, {
    title: "Select Style Guide",
    placeHolder: "Choose a style guide for content checking",
    canPickMany: false,
    matchOnDescription: true,
    matchOnDetail: true,
  });

  if (selected && selected.detail) {
    await getConfig().update(
      "styleGuide",
      selected.detail,
      vscode.ConfigurationTarget.Global
    );
    vscode.window.showInformationMessage(
      `MarkupAI: Style guide set to "${selected.label}"`
    );

    // Re-check active document
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      checkDocument(editor.document, true);
    }
  }
}

async function selectDialect(): Promise<void> {
  const currentDialect = getDialect();
  const items: vscode.QuickPickItem[] = DIALECTS.map((d) => ({
    label: d.label,
    detail: d.value,
    picked: d.value === currentDialect,
  }));

  const selected = await vscode.window.showQuickPick(items, {
    title: "Select Dialect",
    placeHolder: "Choose your preferred English dialect",
    canPickMany: false,
  });

  if (selected && selected.detail) {
    await getConfig().update(
      "dialect",
      selected.detail,
      vscode.ConfigurationTarget.Global
    );
    vscode.window.showInformationMessage(
      `MarkupAI: Dialect set to "${selected.label}"`
    );

    // Re-check active document
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      checkDocument(editor.document, true);
    }
  }
}

async function showScoresDialog(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showInformationMessage("No active editor");
    return;
  }

  const scores = documentScores.get(editor.document.uri.toString());
  if (!scores) {
    vscode.window.showInformationMessage(
      "No scores available. Run a check first."
    );
    return;
  }

  const issues = documentIssues.get(editor.document.uri.toString()) || [];
  const grammarCount = issues.filter(
    (i) => i.type === "grammar" || i.category === "grammar"
  ).length;
  const consistencyCount = issues.filter(
    (i) => i.type === "consistency" || i.category === "consistency"
  ).length;
  const terminologyCount = issues.filter(
    (i) => i.type === "terminology" || i.category === "terminology"
  ).length;
  const otherCount =
    issues.length - grammarCount - consistencyCount - terminologyCount;

  // Get current settings for display
  const currentStyleGuide = getStyleGuide();
  const currentDialect = getDialect();
  const dialectLabel = DIALECTS.find(d => d.value === currentDialect)?.label || currentDialect;
  const styleGuideLabel = cachedStyleGuides.find(g => g.id === currentStyleGuide)?.name || currentStyleGuide;

  const items: vscode.QuickPickItem[] = [
    {
      label: "Scores",
      kind: vscode.QuickPickItemKind.Separator,
    },
    {
      label: `${getScoreEmoji(scores.overall)} Overall: ${scores.overall}`,
      description: `${issues.length} issues`,
    },
    {
      label: `${getScoreEmoji(scores.grammar)} Grammar: ${scores.grammar}`,
      description: `${grammarCount} issues`,
    },
    {
      label: `${getScoreEmoji(scores.consistency)} Consistency: ${scores.consistency}`,
      description: `${consistencyCount} issues`,
    },
    {
      label: `${getScoreEmoji(scores.terminology)} Terminology: ${scores.terminology}`,
      description: `${terminologyCount} issues`,
    },
  ];

  if (otherCount > 0) {
    items.push({
      label: `📋 Other: ${otherCount} issues`,
    });
  }

  // Add configuration options
  items.push(
    {
      label: "Settings",
      kind: vscode.QuickPickItemKind.Separator,
    },
    {
      label: "$(gear) Style Guide",
      description: styleGuideLabel,
      detail: "Click to change style guide",
    },
    {
      label: "$(globe) Dialect",
      description: dialectLabel,
      detail: "Click to change dialect",
    }
  );

  const selected = await vscode.window.showQuickPick(items, {
    title: "MarkupAI Content Scores",
    placeHolder: "Content quality scores for current document",
    canPickMany: false,
  });

  if (selected?.label.includes("Style Guide")) {
    await selectStyleGuide();
  } else if (selected?.label.includes("Dialect")) {
    await selectDialect();
  }
}

// ============================================================================
// Findings Panel - TreeView for Issues
// ============================================================================

interface FindingTreeItem {
  type: 'file' | 'issue';
  uri?: vscode.Uri;
  issue?: ContentIssue;
  label: string;
  children?: FindingTreeItem[];
}

class FindingsTreeDataProvider implements vscode.TreeDataProvider<FindingTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<FindingTreeItem | undefined | null | void> = 
    new vscode.EventEmitter<FindingTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<FindingTreeItem | undefined | null | void> = 
    this._onDidChangeTreeData.event;

  private severityFilter: string | null = null;
  private categoryFilter: string | null = null;
  private showAllFiles: boolean = true;

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  setSeverityFilter(severity: string | null): void {
    this.severityFilter = severity;
    this.refresh();
  }

  setCategoryFilter(category: string | null): void {
    this.categoryFilter = category;
    this.refresh();
  }

  clearFilters(): void {
    this.severityFilter = null;
    this.categoryFilter = null;
    this.refresh();
  }

  setShowAllFiles(showAll: boolean): void {
    this.showAllFiles = showAll;
    vscode.commands.executeCommand('setContext', 'markupai.showAllFiles', showAll);
    this.refresh();
  }

  getFilters(): { severity: string | null; category: string | null } {
    return { severity: this.severityFilter, category: this.categoryFilter };
  }

  getTreeItem(element: FindingTreeItem): vscode.TreeItem {
    if (element.type === 'file') {
      const treeItem = new vscode.TreeItem(
        element.label,
        vscode.TreeItemCollapsibleState.Expanded
      );
      treeItem.iconPath = vscode.ThemeIcon.File;
      treeItem.resourceUri = element.uri;
      treeItem.description = `${element.children?.length || 0} issues`;
      return treeItem;
    } else {
      // Issue item
      const issue = element.issue!;
      const treeItem = new vscode.TreeItem(
        element.label,
        vscode.TreeItemCollapsibleState.None
      );
      
      // Set icon based on severity with colors matching SonarQube style
      if (issue.severity === 'high') {
        treeItem.iconPath = new vscode.ThemeIcon(
          'circle-filled',
          new vscode.ThemeColor('charts.red')
        );
      } else if (issue.severity === 'medium') {
        treeItem.iconPath = new vscode.ThemeIcon(
          'circle-filled',
          new vscode.ThemeColor('charts.yellow')
        );
      } else {
        treeItem.iconPath = new vscode.ThemeIcon(
          'circle-filled',
          new vscode.ThemeColor('charts.blue')
        );
      }
      
      // Add description with category
      treeItem.description = issue.category || issue.type;
      
      // Add tooltip
      treeItem.tooltip = new vscode.MarkdownString();
      treeItem.tooltip.appendMarkdown(`**${issue.category || issue.type}**\n\n`);
      treeItem.tooltip.appendMarkdown(`${issue.message}\n\n`);
      if (issue.suggestion) {
        treeItem.tooltip.appendMarkdown(`**Suggestion:** \`${issue.suggestion}\``);
      }
      
      // Command to navigate to issue
      treeItem.command = {
        command: 'markupai.goToIssue',
        title: 'Go to Issue',
        arguments: [element.uri, issue]
      };
      
      return treeItem;
    }
  }

  getChildren(element?: FindingTreeItem): Thenable<FindingTreeItem[]> {
    if (!element) {
      // Root level - return files with issues
      return Promise.resolve(this.getFileItems());
    } else if (element.type === 'file') {
      // Return issues for this file
      return Promise.resolve(element.children || []);
    }
    return Promise.resolve([]);
  }

  private getFileItems(): FindingTreeItem[] {
    const items: FindingTreeItem[] = [];
    const activeEditor = vscode.window.activeTextEditor;
    
    // Get all document URIs that have issues
    const urisToShow: string[] = [];
    
    if (this.showAllFiles) {
      // Show all files with issues
      documentIssues.forEach((_, uriString) => {
        urisToShow.push(uriString);
      });
    } else {
      // Show only current file
      if (activeEditor) {
        const currentUri = activeEditor.document.uri.toString();
        if (documentIssues.has(currentUri)) {
          urisToShow.push(currentUri);
        }
      }
    }

    for (const uriString of urisToShow) {
      const uri = vscode.Uri.parse(uriString);
      let issues = documentIssues.get(uriString) || [];
      
      // Apply filters
      if (this.severityFilter) {
        issues = issues.filter(i => i.severity === this.severityFilter);
      }
      if (this.categoryFilter) {
        issues = issues.filter(i => i.category === this.categoryFilter || i.type === this.categoryFilter);
      }
      
      if (issues.length === 0) { continue; }

      // Get document to convert indices to line numbers
      const document = vscode.workspace.textDocuments.find(d => d.uri.toString() === uriString);
      
      const issueItems: FindingTreeItem[] = issues.map(issue => {
        let lineInfo = '';
        if (document) {
          const position = document.positionAt(issue.startIndex);
          lineInfo = `Ln ${position.line + 1}`;
        }
        
        // Truncate message if too long
        let label = issue.message;
        if (label.length > 80) {
          label = label.substring(0, 77) + '...';
        }
        
        return {
          type: 'issue' as const,
          uri: uri,
          issue: issue,
          label: `${label} (${lineInfo})`
        };
      });

      // Get just the filename for display
      const fileName = uri.path.split('/').pop() || uri.path;
      
      items.push({
        type: 'file',
        uri: uri,
        label: fileName,
        children: issueItems
      });
    }

    return items;
  }

  getTotalIssueCount(): number {
    let count = 0;
    documentIssues.forEach(issues => {
      let filtered = issues;
      if (this.severityFilter) {
        filtered = filtered.filter(i => i.severity === this.severityFilter);
      }
      if (this.categoryFilter) {
        filtered = filtered.filter(i => i.category === this.categoryFilter || i.type === this.categoryFilter);
      }
      count += filtered.length;
    });
    return count;
  }

  getAvailableCategories(): string[] {
    const categories = new Set<string>();
    documentIssues.forEach(issues => {
      issues.forEach(issue => {
        if (issue.category) { categories.add(issue.category); }
        categories.add(issue.type);
      });
    });
    return Array.from(categories);
  }

  getAvailableSeverities(): string[] {
    const severities = new Set<string>();
    documentIssues.forEach(issues => {
      issues.forEach(issue => {
        severities.add(issue.severity);
      });
    });
    return Array.from(severities);
  }
}

let findingsTreeDataProvider: FindingsTreeDataProvider;

// ============================================================================
// Folder Scanner - TreeView for Bulk Checking
// ============================================================================

interface FolderScannerItem {
  type: 'folder' | 'file';
  uri: vscode.Uri;
  label: string;
  isSelected: boolean;
  children?: FolderScannerItem[];
}

class FolderScannerTreeDataProvider implements vscode.TreeDataProvider<FolderScannerItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<FolderScannerItem | undefined | null | void> = 
    new vscode.EventEmitter<FolderScannerItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<FolderScannerItem | undefined | null | void> = 
    this._onDidChangeTreeData.event;

  private rootFolder: vscode.Uri | null = null;
  private selectedFiles: Set<string> = new Set();
  private fileExtensions = ['.md', '.txt', '.rst', '.adoc', '.tex'];

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  setRootFolder(folder: vscode.Uri): void {
    this.rootFolder = folder;
    this.selectedFiles.clear();
    this.refresh();
  }

  toggleFileSelection(item: FolderScannerItem): void {
    const uriString = item.uri.toString();
    if (this.selectedFiles.has(uriString)) {
      this.selectedFiles.delete(uriString);
    } else {
      this.selectedFiles.add(uriString);
    }
    this.refresh();
  }

  selectAll(): void {
    if (!this.rootFolder) { return; }
    this.getAllFiles().then(files => {
      files.forEach(file => this.selectedFiles.add(file.toString()));
      this.refresh();
    });
  }

  deselectAll(): void {
    this.selectedFiles.clear();
    this.refresh();
  }

  getSelectedFiles(): vscode.Uri[] {
    return Array.from(this.selectedFiles).map(uriString => vscode.Uri.parse(uriString));
  }

  async getAllFiles(): Promise<vscode.Uri[]> {
    if (!this.rootFolder) { return []; }
    const files: vscode.Uri[] = [];
    await this.collectFiles(this.rootFolder, files);
    return files;
  }

  private async collectFiles(folder: vscode.Uri, files: vscode.Uri[]): Promise<void> {
    try {
      const entries = await vscode.workspace.fs.readDirectory(folder);
      
      for (const [name, type] of entries) {
        // Skip hidden files and folders, and common ignore patterns
        if (name.startsWith('.') || name === 'node_modules' || name === 'dist' || name === 'build') {
          continue;
        }

        const uri = vscode.Uri.joinPath(folder, name);
        
        if (type === vscode.FileType.Directory) {
          await this.collectFiles(uri, files);
        } else if (type === vscode.FileType.File) {
          // Check if file has a supported extension
          if (this.fileExtensions.some(ext => name.endsWith(ext))) {
            files.push(uri);
          }
        }
      }
    } catch (error) {
      console.error(`Error reading directory ${folder.fsPath}:`, error);
    }
  }

  getTreeItem(element: FolderScannerItem): vscode.TreeItem {
    const treeItem = new vscode.TreeItem(
      element.label,
      element.type === 'folder' 
        ? vscode.TreeItemCollapsibleState.Expanded 
        : vscode.TreeItemCollapsibleState.None
    );

    if (element.type === 'folder') {
      treeItem.iconPath = vscode.ThemeIcon.Folder;
      treeItem.contextValue = 'folder';
    } else {
      // File item
      const isSelected = this.selectedFiles.has(element.uri.toString());
      treeItem.iconPath = new vscode.ThemeIcon(
        isSelected ? 'check' : 'circle-outline'
      );
      treeItem.contextValue = 'file';
      treeItem.resourceUri = element.uri;
      
      // Check if file has been checked and show status
      const docKey = element.uri.toString();
      if (documentScores.has(docKey)) {
        const score = documentScores.get(docKey)!;
        const emoji = getScoreEmoji(score.overall);
        treeItem.description = `${emoji} ${score.overall}`;
      }

      // Make file clickable to open it
      treeItem.command = {
        command: 'markupai.openFile',
        title: 'Open File',
        arguments: [element.uri]
      };
    }

    return treeItem;
  }

  async getChildren(element?: FolderScannerItem): Promise<FolderScannerItem[]> {
    if (!this.rootFolder) {
      return [];
    }

    if (!element) {
      // Root level - show folder contents
      return this.getFolderContents(this.rootFolder);
    } else if (element.type === 'folder') {
      return this.getFolderContents(element.uri);
    }
    
    return [];
  }

  private async getFolderContents(folder: vscode.Uri): Promise<FolderScannerItem[]> {
    const items: FolderScannerItem[] = [];
    
    try {
      const entries = await vscode.workspace.fs.readDirectory(folder);
      
      // Sort: folders first, then files
      const folders: [string, vscode.FileType][] = [];
      const files: [string, vscode.FileType][] = [];
      
      for (const entry of entries) {
        const [name] = entry;
        // Skip hidden and ignored items
        if (name.startsWith('.') || name === 'node_modules' || name === 'dist' || name === 'build') {
          continue;
        }
        
        if (entry[1] === vscode.FileType.Directory) {
          folders.push(entry);
        } else if (entry[1] === vscode.FileType.File) {
          // Only show supported file types
          if (this.fileExtensions.some(ext => name.endsWith(ext))) {
            files.push(entry);
          }
        }
      }

      // Add folders
      for (const [name, type] of folders) {
        const uri = vscode.Uri.joinPath(folder, name);
        items.push({
          type: 'folder',
          uri: uri,
          label: name,
          isSelected: false
        });
      }

      // Add files
      for (const [name, type] of files) {
        const uri = vscode.Uri.joinPath(folder, name);
        const isSelected = this.selectedFiles.has(uri.toString());
        items.push({
          type: 'file',
          uri: uri,
          label: name,
          isSelected: isSelected
        });
      }
    } catch (error) {
      console.error(`Error reading directory ${folder.fsPath}:`, error);
    }

    return items;
  }
}

let folderScannerTreeDataProvider: FolderScannerTreeDataProvider;

// ============================================================================
// Bulk File Checking
// ============================================================================

async function checkMultipleFiles(files: vscode.Uri[]): Promise<void> {
  const totalFiles = files.length;
  let completed = 0;
  let failed = 0;
  const errors: string[] = [];

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `MarkupAI: Checking ${totalFiles} file(s)...`,
      cancellable: false
    },
    async (progress) => {
      for (const fileUri of files) {
        const fileName = fileUri.path.split('/').pop() || fileUri.path;
        progress.report({
          message: `Checking ${fileName} (${completed + 1}/${totalFiles})`,
          increment: (1 / totalFiles) * 100
        });

        try {
          const document = await vscode.workspace.openTextDocument(fileUri);
          // Pass false for showProgress and showCompletionNotification during batch operations
          await checkDocument(document, false, false);
          completed++;
        } catch (error: any) {
          failed++;
          errors.push(`${fileName}: ${error?.message || 'Unknown error'}`);
          console.error(`MarkupAI: Error checking ${fileName}`, error);
        }
      }
    }
  );

  // Refresh the folder scanner to show updated scores
  folderScannerTreeDataProvider.refresh();
  
  // Refresh findings panel
  if (findingsTreeDataProvider) {
    findingsTreeDataProvider.refresh();
  }

  // Show completion summary
  let message = `MarkupAI: Checked ${completed} file(s)`;
  if (failed > 0) {
    message += `, ${failed} failed`;
  }

  if (failed === 0) {
    const action = await vscode.window.showInformationMessage(
      message,
      "View Findings"
    );
    if (action === "View Findings") {
      vscode.commands.executeCommand("markupai.findings.focus");
    }
  } else {
    const action = await vscode.window.showWarningMessage(
      message,
      "View Findings",
      "Show Errors"
    );
    if (action === "View Findings") {
      vscode.commands.executeCommand("markupai.findings.focus");
    } else if (action === "Show Errors") {
      const errorMessage = errors.join('\n');
      vscode.window.showErrorMessage(`Errors:\n${errorMessage}`);
    }
  }
}

// ============================================================================
// Activation
// ============================================================================

export function activate(context: vscode.ExtensionContext) {
  console.log("MarkupAI extension is now active!");

  // Initialize diagnostic collection
  diagnosticCollection =
    vscode.languages.createDiagnosticCollection("markupai");
  context.subscriptions.push(diagnosticCollection);

  // Initialize status bar
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBarItem.name = "MarkupAI Score";
  context.subscriptions.push(statusBarItem);

  // Set initial enabled state from config and update context for menu visibility
  isEnabled = getConfig().get("enabled", true);
  vscode.commands.executeCommand("setContext", "markupai.enabled", isEnabled);
  vscode.commands.executeCommand("setContext", "markupai.showAllFiles", true);

  // Fetch style guides from server on startup (async, don't block activation)
  if (hasApiToken()) {
    refreshStyleGuides().catch((error) => {
      console.error("MarkupAI: Failed to fetch style guides on startup", error);
    });
  }

  // Initialize Findings TreeView
  findingsTreeDataProvider = new FindingsTreeDataProvider();
  const findingsTreeView = vscode.window.createTreeView("markupai.findings", {
    treeDataProvider: findingsTreeDataProvider,
    showCollapseAll: true
  });
  context.subscriptions.push(findingsTreeView);

  // Initialize Folder Scanner TreeView
  folderScannerTreeDataProvider = new FolderScannerTreeDataProvider();
  const folderScannerTreeView = vscode.window.createTreeView("markupai.folderScanner", {
    treeDataProvider: folderScannerTreeDataProvider,
    showCollapseAll: true
  });
  context.subscriptions.push(folderScannerTreeView);

  // Update tree view title with issue count
  const updateTreeViewTitle = () => {
    const count = findingsTreeDataProvider.getTotalIssueCount();
    const filters = findingsTreeDataProvider.getFilters();
    let title = `Findings (${count})`;
    if (filters.severity || filters.category) {
      const activeFilters = [filters.severity, filters.category].filter(Boolean).join(", ");
      title += ` - Filtered: ${activeFilters}`;
    }
    findingsTreeView.title = title;
  };

  // Register findings panel commands
  context.subscriptions.push(
    vscode.commands.registerCommand("markupai.goToIssue", async (uri: vscode.Uri, issue: ContentIssue) => {
      const document = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(document);
      const startPos = document.positionAt(issue.startIndex);
      const endPos = document.positionAt(issue.endIndex);
      const range = new vscode.Range(startPos, endPos);
      editor.selection = new vscode.Selection(range.start, range.end);
      editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("markupai.refreshFindings", () => {
      findingsTreeDataProvider.refresh();
      updateTreeViewTitle();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("markupai.filterBySeverity", async () => {
      const severities = findingsTreeDataProvider.getAvailableSeverities();
      if (severities.length === 0) {
        vscode.window.showInformationMessage("No issues found to filter");
        return;
      }
      
      const items = severities.map(s => ({
        label: s === 'high' ? '🔴 High' : s === 'medium' ? '🟡 Medium' : '🔵 Low',
        value: s
      }));
      items.unshift({ label: 'All Severities', value: '' });
      
      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select severity to filter'
      });
      
      if (selected) {
        findingsTreeDataProvider.setSeverityFilter(selected.value || null);
        updateTreeViewTitle();
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("markupai.filterByCategory", async () => {
      const categories = findingsTreeDataProvider.getAvailableCategories();
      if (categories.length === 0) {
        vscode.window.showInformationMessage("No issues found to filter");
        return;
      }
      
      const items = categories.map(c => ({
        label: c.charAt(0).toUpperCase() + c.slice(1),
        value: c
      }));
      items.unshift({ label: 'All Categories', value: '' });
      
      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select category to filter'
      });
      
      if (selected) {
        findingsTreeDataProvider.setCategoryFilter(selected.value || null);
        updateTreeViewTitle();
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("markupai.clearFilters", () => {
      findingsTreeDataProvider.clearFilters();
      updateTreeViewTitle();
      vscode.window.showInformationMessage("Filters cleared");
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("markupai.showAllFindings", () => {
      findingsTreeDataProvider.setShowAllFiles(true);
      updateTreeViewTitle();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("markupai.showCurrentFileFindings", () => {
      findingsTreeDataProvider.setShowAllFiles(false);
      updateTreeViewTitle();
    })
  );

  // ============================================================================
  // Folder Scanner Commands
  // ============================================================================

  context.subscriptions.push(
    vscode.commands.registerCommand("markupai.selectFolder", async () => {
      const folderUri = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: "Select Folder to Scan",
        title: "Select folder containing documents to check"
      });

      if (folderUri && folderUri[0]) {
        folderScannerTreeDataProvider.setRootFolder(folderUri[0]);
        vscode.window.showInformationMessage(
          `Folder selected: ${folderUri[0].fsPath}\nSelect files and click "Check Selected Files"`
        );
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("markupai.refreshFolderScanner", () => {
      folderScannerTreeDataProvider.refresh();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("markupai.openFile", async (uri: vscode.Uri) => {
      const document = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(document);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("markupai.toggleFileSelection", (item: FolderScannerItem) => {
      folderScannerTreeDataProvider.toggleFileSelection(item);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("markupai.checkAllFiles", async () => {
      if (!hasApiToken()) {
        const action = await vscode.window.showWarningMessage(
          "MarkupAI: API token required",
          "Configure Token"
        );
        if (action === "Configure Token") {
          await configureApiToken();
        }
        return;
      }

      const files = await folderScannerTreeDataProvider.getAllFiles();
      if (files.length === 0) {
        vscode.window.showInformationMessage("No supported files found in selected folder");
        return;
      }

      await checkMultipleFiles(files);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("markupai.checkSelectedFiles", async () => {
      if (!hasApiToken()) {
        const action = await vscode.window.showWarningMessage(
          "MarkupAI: API token required",
          "Configure Token"
        );
        if (action === "Configure Token") {
          await configureApiToken();
        }
        return;
      }

      const selectedFiles = folderScannerTreeDataProvider.getSelectedFiles();
      if (selectedFiles.length === 0) {
        vscode.window.showInformationMessage(
          "No files selected. Click on files to select them, then run this command."
        );
        return;
      }

      await checkMultipleFiles(selectedFiles);
    })
  );

  // Register Code Actions Provider (for quick fixes)
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      { scheme: "file" },
      new MarkupAICodeActionProvider(),
      {
        providedCodeActionKinds:
          MarkupAICodeActionProvider.providedCodeActionKinds,
      }
    )
  );

  // Register Hover Provider
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(
      { scheme: "file" },
      new MarkupAIHoverProvider()
    )
  );

  // Register Commands
  context.subscriptions.push(
    vscode.commands.registerCommand("markupai.checkContent", () => {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        checkDocument(editor.document, true);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("markupai.toggleEnabled", async () => {
      await setMarkupAIEnabled(!isEnabled);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("markupai.enableIssues", async () => {
      await setMarkupAIEnabled(true);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("markupai.disableIssues", async () => {
      await setMarkupAIEnabled(false);
    })
  );

  // Command to disable a specific category
  context.subscriptions.push(
    vscode.commands.registerCommand("markupai.disableCategory", async (category: string) => {
      if (!category) {
        return;
      }
      
      disabledCategories.add(category.toLowerCase());
      const categoryLabel = category.charAt(0).toUpperCase() + category.slice(1);
      vscode.window.showInformationMessage(`MarkupAI: ${categoryLabel} issues are now hidden. Use "MarkupAI: Enable Category" to show them again.`);
      
      // Remove diagnostics for this category from all documents
      filterDiagnosticsByDisabledCategories();
      findingsTreeDataProvider?.refresh();
    })
  );

  // Command to enable a specific category
  context.subscriptions.push(
    vscode.commands.registerCommand("markupai.enableCategory", async () => {
      if (disabledCategories.size === 0) {
        vscode.window.showInformationMessage("MarkupAI: All categories are already enabled.");
        return;
      }

      const categories = Array.from(disabledCategories).map(cat => ({
        label: cat.charAt(0).toUpperCase() + cat.slice(1),
        value: cat
      }));

      const selected = await vscode.window.showQuickPick(
        categories.map(c => c.label),
        {
          placeHolder: "Select a category to enable",
          canPickMany: true
        }
      );

      if (selected && selected.length > 0) {
        for (const label of selected) {
          const cat = categories.find(c => c.label === label);
          if (cat) {
            disabledCategories.delete(cat.value);
          }
        }
        
        vscode.window.showInformationMessage(`MarkupAI: Enabled ${selected.join(", ")} issues. Run "MarkupAI - Check Content" to see them.`);
        findingsTreeDataProvider?.refresh();
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("markupai.showScores", showScoresDialog)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "markupai.configureApiToken",
      configureApiToken
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "markupai.selectStyleGuide",
      selectStyleGuide
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("markupai.selectDialect", selectDialect)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("markupai.applyFix", async (args: any) => {
      if (!args) {
        return;
      }

      const parsedArgs = typeof args === "string" ? JSON.parse(args) : args;
      const uri = vscode.Uri.parse(parsedArgs.uri);
      const range = new vscode.Range(
        new vscode.Position(
          parsedArgs.range.start.line,
          parsedArgs.range.start.character
        ),
        new vscode.Position(
          parsedArgs.range.end.line,
          parsedArgs.range.end.character
        )
      );

      // Remove the diagnostic and any overlapping diagnostics before applying the fix
      const currentDiagnostics = diagnosticCollection.get(uri);
      if (currentDiagnostics) {
        const updatedDiagnostics = currentDiagnostics.filter((d) => {
          // Check if ranges overlap: two ranges overlap if one starts before the other ends
          // and ends after the other starts
          const rangesOverlap =
            d.range.start.isBefore(range.end) &&
            d.range.end.isAfter(range.start);
          const rangesEqual = d.range.isEqual(range);
          // Remove if overlapping or equal
          return !rangesOverlap && !rangesEqual;
        });
        diagnosticCollection.set(uri, updatedDiagnostics);
      }

      // Set flag to prevent re-checking when applying fix
      isApplyingFix = true;
      
      const edit = new vscode.WorkspaceEdit();
      edit.replace(uri, range, parsedArgs.suggestion);
      await vscode.workspace.applyEdit(edit);
      
      // Reset flag after a short delay to allow the document change event to fire
      setTimeout(() => {
        isApplyingFix = false;
      }, 100);
    })
  );

  // Document Events
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((document) => {
      if (getConfig().get("checkOnOpen", true)) {
        checkDocument(document);
      }
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      // Skip re-checking if we're applying a fix from the extension
      // This prevents unnecessary API calls when user accepts suggestions
      if (isApplyingFix) {
        return;
      }
      
      // Only auto-check on change if the setting is enabled (default: false)
      if (getConfig().get("checkOnChange", false)) {
        scheduleCheck(event.document);
      }
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((document) => {
      clearDiagnostics(document);
      const timer = checkDebounceTimers.get(document.uri.toString());
      if (timer) {
        clearTimeout(timer);
        checkDebounceTimers.delete(document.uri.toString());
      }
    })
  );

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) {
        const scores = documentScores.get(editor.document.uri.toString());
        if (scores) {
          updateStatusBar(scores);
        } else if (!hasApiToken()) {
          updateStatusBarNoToken();
        } else {
          checkDocument(editor.document);
        }
      } else {
        statusBarItem.hide();
      }
    })
  );

  // Configuration change listener
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("markupai.enabled")) {
        isEnabled = getConfig().get("enabled", true);
        // Update context for menu visibility
        vscode.commands.executeCommand(
          "setContext",
          "markupai.enabled",
          isEnabled
        );

        if (!isEnabled) {
          clearAllDiagnostics();
          statusBarItem.text = "$(circle-slash) MarkupAI: Disabled";
          statusBarItem.tooltip =
            "MarkupAI issues are disabled. Right-click to enable.";
          statusBarItem.command = "markupai.enableIssues";
          statusBarItem.backgroundColor = undefined;
          statusBarItem.show();
        } else {
          const editor = vscode.window.activeTextEditor;
          if (editor) {
            checkDocument(editor.document);
          }
        }
      }

      if (event.affectsConfiguration("markupai.apiToken")) {
        refreshStyleGuides();
      }
    })
  );

  // Initial setup
  if (hasApiToken()) {
    refreshStyleGuides();
  }

  // Check currently open document on activation
  if (vscode.window.activeTextEditor) {
    if (hasApiToken()) {
      checkDocument(vscode.window.activeTextEditor.document);
    } else {
      updateStatusBarNoToken();
    }
  } else if (!hasApiToken()) {
    updateStatusBarNoToken();
  }
}

// This method is called when your extension is deactivated
export function deactivate() {
  for (const timer of checkDebounceTimers.values()) {
    clearTimeout(timer);
  }
  checkDebounceTimers.clear();
}
