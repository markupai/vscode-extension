import * as vscode from "vscode";
import { MarkupAIDiagnostic } from "./types";

/**
 * Provides quick-fix code actions for MarkupAI diagnostics.
 */
export class MarkupAICodeActionProvider implements vscode.CodeActionProvider {
  static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  provideCodeActions(
    document: vscode.TextDocument,
    _range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
    _cancellationToken: vscode.CancellationToken,
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];

    for (const diagnostic of context.diagnostics) {
      if (diagnostic.source !== "MarkupAI") {
        continue;
      }

      const markupDiagnostic = diagnostic as MarkupAIDiagnostic;
      const suggestion = markupDiagnostic.markupaiSuggestion;
      const originalText = markupDiagnostic.markupaiOriginalText;
      const category = markupDiagnostic.markupaiCategory;

      if (suggestion && suggestion !== originalText) {
        const action = new vscode.CodeAction(
          `Fix: Replace "${originalText}" with "${suggestion}"`,
          vscode.CodeActionKind.QuickFix,
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

        if (category) {
          const categoryLabel = category.charAt(0).toUpperCase() + category.slice(1);
          const disableCategoryAction = new vscode.CodeAction(
            `Disable ${categoryLabel} Issues`,
            vscode.CodeActionKind.QuickFix,
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
