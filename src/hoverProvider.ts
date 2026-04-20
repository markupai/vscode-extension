import * as vscode from "vscode";
import type { DiagnosticsManager } from "./diagnostics.js";
import type { IssueWithId } from "./types.js";

/**
 * Shows a rich hover for any MarkupAI issue overlapping the cursor:
 * explanation, suggested replacement (if any), severity, and the
 * agent that raised it.
 */
export class MarkupAIHoverProvider implements vscode.HoverProvider {
  constructor(private readonly diagnostics: DiagnosticsManager) {}

  provideHover(
    doc: vscode.TextDocument,
    pos: vscode.Position,
  ): vscode.ProviderResult<vscode.Hover> {
    const hits = this.diagnostics.getIssuesAt(doc.uri, pos, doc);
    if (!hits.length) return undefined;
    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    md.supportHtml = false;
    for (const issue of hits) {
      md.appendMarkdown(formatIssue(issue));
      md.appendMarkdown("\n\n---\n\n");
    }
    return new vscode.Hover(md);
  }
}

function formatIssue(issue: IssueWithId): string {
  const agent = issue.agentName ?? issue.agent;
  const lines: string[] = [];
  lines.push(`**MarkupAI · ${agent}** _(${issue.severity})_`);
  lines.push("");
  lines.push(issue.explanation);
  if (issue.suggestion) {
    lines.push("");
    lines.push("**Suggestion:**");
    lines.push("```");
    lines.push(issue.suggestion);
    lines.push("```");
  }
  return lines.join("\n");
}
