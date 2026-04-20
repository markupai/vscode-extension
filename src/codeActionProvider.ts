import * as vscode from "vscode";
import type { DiagnosticsManager } from "./diagnostics.js";
import type { IssueWithId } from "./types.js";

/**
 * Surfaces Quick-Fix code actions for issues that carry a suggestion.
 * The fix replaces the issue's range with the suggested text.
 */
export class MarkupAICodeActionProvider implements vscode.CodeActionProvider {
  static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  constructor(private readonly diagnostics: DiagnosticsManager) {}

  provideCodeActions(
    doc: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
  ): vscode.ProviderResult<vscode.CodeAction[]> {
    const position = "active" in range ? range.active : range.start;
    const issues = this.diagnostics.getIssuesAt(doc.uri, position, doc);
    const actions: vscode.CodeAction[] = [];
    for (const issue of issues) {
      if (!issue.suggestion) continue;
      actions.push(buildFix(doc, issue));
    }
    if (issues.length) {
      actions.push(buildIgnore(doc, issues));
    }
    return actions;
  }
}

function buildFix(doc: vscode.TextDocument, issue: IssueWithId): vscode.CodeAction {
  const fix = new vscode.CodeAction(
    `MarkupAI: apply suggestion — ${truncate(issue.suggestion ?? "", 60)}`,
    vscode.CodeActionKind.QuickFix,
  );
  const edit = new vscode.WorkspaceEdit();
  const range = new vscode.Range(
    doc.positionAt(issue.position.start),
    doc.positionAt(issue.position.end),
  );
  edit.replace(doc.uri, range, issue.suggestion ?? "");
  fix.edit = edit;
  fix.isPreferred = true;
  return fix;
}

function buildIgnore(doc: vscode.TextDocument, issues: readonly IssueWithId[]): vscode.CodeAction {
  const action = new vscode.CodeAction(
    `MarkupAI: dismiss ${issues.length === 1 ? "issue" : `${issues.length} issues`} at cursor`,
    vscode.CodeActionKind.QuickFix,
  );
  action.command = {
    command: "markupai._dismissIssues",
    title: "Dismiss issues",
    arguments: [doc.uri.toString(), issues.map((i) => i.id)],
  };
  return action;
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
