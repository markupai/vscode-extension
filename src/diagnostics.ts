import * as vscode from "vscode";
import { DIAGNOSTIC_SOURCE } from "./constants.js";
import type { IssueSeverity, IssueWithId } from "./types.js";

/**
 * Owns a single DiagnosticCollection and keeps an in-memory index so
 * code actions and hovers can look up the original issue from a range.
 *
 * Supports merging batches of issues from multiple agents — each
 * agent's issues are stored keyed by agent slug, so a re-scan of one
 * agent doesn't clobber results from others.
 */
export class DiagnosticsManager {
  private readonly collection: vscode.DiagnosticCollection;
  private readonly byUri = new Map<string, Map<string, IssueWithId[]>>();

  constructor() {
    this.collection = vscode.languages.createDiagnosticCollection(DIAGNOSTIC_SOURCE);
  }

  /** Replace the set of issues for (uri, agent) and re-publish diagnostics. */
  setIssuesForAgent(uri: vscode.Uri, agentSlug: string, issues: readonly IssueWithId[]): void {
    const key = uri.toString();
    const perAgent = this.byUri.get(key) ?? new Map<string, IssueWithId[]>();
    perAgent.set(agentSlug, [...issues]);
    this.byUri.set(key, perAgent);
    this.publish(uri);
  }

  clear(uri?: vscode.Uri): void {
    if (uri) {
      this.byUri.delete(uri.toString());
      this.collection.delete(uri);
    } else {
      this.byUri.clear();
      this.collection.clear();
    }
  }

  getIssuesAt(uri: vscode.Uri, position: vscode.Position, doc: vscode.TextDocument): IssueWithId[] {
    const perAgent = this.byUri.get(uri.toString());
    if (!perAgent) return [];
    const offset = doc.offsetAt(position);
    const hits: IssueWithId[] = [];
    for (const list of perAgent.values()) {
      for (const issue of list) {
        if (offset >= issue.position.start && offset <= issue.position.end) {
          hits.push(issue);
        }
      }
    }
    return hits;
  }

  getAllIssues(uri: vscode.Uri): IssueWithId[] {
    const perAgent = this.byUri.get(uri.toString());
    if (!perAgent) return [];
    const result: IssueWithId[] = [];
    for (const list of perAgent.values()) result.push(...list);
    return result;
  }

  dispose(): void {
    this.collection.dispose();
  }

  private publish(uri: vscode.Uri): void {
    const doc = findDocument(uri);
    const perAgent = this.byUri.get(uri.toString());
    if (!perAgent) {
      this.collection.set(uri, []);
      return;
    }
    const diagnostics: vscode.Diagnostic[] = [];
    for (const list of perAgent.values()) {
      for (const issue of list) {
        diagnostics.push(toDiagnostic(issue, doc));
      }
    }
    this.collection.set(uri, diagnostics);
  }
}

function findDocument(uri: vscode.Uri): vscode.TextDocument | undefined {
  return vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
}

export function toDiagnostic(issue: IssueWithId, doc?: vscode.TextDocument): vscode.Diagnostic {
  const range = rangeFromOffsets(issue.position.start, issue.position.end, doc);
  const diag = new vscode.Diagnostic(range, issue.explanation, severityToVscode(issue.severity));
  diag.source = DIAGNOSTIC_SOURCE;
  diag.code = issue.agentName ?? issue.agent;
  return diag;
}

function rangeFromOffsets(
  start: number,
  end: number,
  doc: vscode.TextDocument | undefined,
): vscode.Range {
  if (doc) {
    return new vscode.Range(doc.positionAt(start), doc.positionAt(Math.max(start, end)));
  }
  return new vscode.Range(
    new vscode.Position(0, start),
    new vscode.Position(0, Math.max(start, end)),
  );
}

function severityToVscode(sev: IssueSeverity): vscode.DiagnosticSeverity {
  switch (sev) {
    case "critical":
    case "high":
      return vscode.DiagnosticSeverity.Error;
    case "medium":
      return vscode.DiagnosticSeverity.Warning;
    case "low":
      return vscode.DiagnosticSeverity.Information;
  }
}
