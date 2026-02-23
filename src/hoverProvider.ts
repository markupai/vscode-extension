import * as vscode from "vscode";
import { ContentIssue, MarkupAIDiagnostic } from "./types";
import { getTypeEmoji } from "./utils";

/**
 * Provides hover information for MarkupAI diagnostics.
 */
export class MarkupAIHoverProvider implements vscode.HoverProvider {
  constructor(
    private readonly getDiagnostics: (uri: vscode.Uri) => readonly vscode.Diagnostic[] | undefined,
  ) {}

  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    _cancellationToken: vscode.CancellationToken,
  ): vscode.Hover | null {
    const diagnostics = this.getDiagnostics(document.uri);
    if (!diagnostics) {
      return null;
    }

    for (const diagnostic of diagnostics) {
      if (diagnostic.range.contains(position)) {
        const markupDiagnostic = diagnostic as MarkupAIDiagnostic;
        const suggestion = markupDiagnostic.markupaiSuggestion;
        const originalText = markupDiagnostic.markupaiOriginalText;
        const category = markupDiagnostic.markupaiCategory;
        const subcategory = markupDiagnostic.markupaiSubcategory;
        const severity = markupDiagnostic.markupaiSeverity;

        const markdown = new vscode.MarkdownString();
        markdown.isTrusted = { enabledCommands: ["markupai.applyFix"] };

        if (category) {
          const categoryLabel = category.charAt(0).toUpperCase() + category.slice(1);
          const categoryEmoji = getTypeEmoji(category as ContentIssue["type"]);
          markdown.appendMarkdown(`### ${categoryEmoji} ${categoryLabel}\n\n`);
        }

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
            }),
          );
          markdown.appendMarkdown(`[Apply Fix](command:markupai.applyFix?${args})\n\n`);
        }

        if (subcategory) {
          const subcategoryLabel = subcategory.charAt(0).toUpperCase() + subcategory.slice(1);
          markdown.appendMarkdown(`**Subcategory:** ${subcategoryLabel}\n\n`);
        }

        if (severity) {
          const severityEmojiMap: Record<string, string> = { high: "🔴", medium: "🟡", low: "🔵" };
          const severityEmoji = severityEmojiMap[severity] ?? "🔵";
          const severityLabel = severity.charAt(0).toUpperCase() + severity.slice(1);
          markdown.appendMarkdown(`**Severity:** ${severityEmoji} ${severityLabel}\n\n`);
        }

        return new vscode.Hover(markdown, diagnostic.range);
      }
    }

    return null;
  }
}
