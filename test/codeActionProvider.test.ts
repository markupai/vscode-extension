import { describe, expect, it } from "vitest";
import * as vscode from "vscode";
import { DiagnosticsManager } from "../src/diagnostics.js";
import { MarkupAICodeActionProvider } from "../src/codeActionProvider.js";
import type { IssueWithId } from "../src/types.js";

function mkIssue(over: Partial<IssueWithId> = {}): IssueWithId {
  return {
    id: "i1",
    agent: "style_agent",
    confidence: 0.9,
    severity: "medium",
    explanation: "use active voice",
    position: { start: 0, end: 5 },
    ...over,
  };
}

function mkDoc(): vscode.TextDocument {
  return {
    uri: vscode.Uri.file("/tmp/a.md"),
    getText: () => "hello world",
    positionAt: (o: number) => new vscode.Position(0, o),
    offsetAt: (p: vscode.Position) => p.character,
  } as unknown as vscode.TextDocument;
}

describe("MarkupAICodeActionProvider", () => {
  it("returns no actions when no issues overlap", () => {
    const mgr = new DiagnosticsManager();
    const p = new MarkupAICodeActionProvider(mgr);
    const actions = p.provideCodeActions(
      mkDoc(),
      new vscode.Range(new vscode.Position(0, 10), new vscode.Position(0, 10)),
    ) as vscode.CodeAction[];
    expect(actions).toEqual([]);
  });

  it("offers a quick-fix when a suggestion is present", () => {
    const mgr = new DiagnosticsManager();
    const doc = mkDoc();
    mgr.setIssuesForAgent(doc.uri, "style_agent", [mkIssue({ suggestion: "Hi" })]);
    const actions = new MarkupAICodeActionProvider(mgr).provideCodeActions(
      doc,
      new vscode.Range(new vscode.Position(0, 2), new vscode.Position(0, 2)),
    ) as vscode.CodeAction[];
    const apply = actions.find((a) => a.title.includes("apply"));
    expect(apply).toBeDefined();
    expect(apply!.edit).toBeDefined();
    const dismiss = actions.find((a) => a.title.includes("dismiss"));
    expect(dismiss?.command?.command).toBe("markupai._dismissIssues");
  });

  it("omits quick-fix when no suggestion but still offers dismiss", () => {
    const mgr = new DiagnosticsManager();
    const doc = mkDoc();
    mgr.setIssuesForAgent(doc.uri, "style_agent", [mkIssue()]);
    const actions = new MarkupAICodeActionProvider(mgr).provideCodeActions(
      doc,
      new vscode.Range(new vscode.Position(0, 2), new vscode.Position(0, 2)),
    ) as vscode.CodeAction[];
    expect(actions.some((a) => a.title.includes("apply"))).toBe(false);
    expect(actions.some((a) => a.title.includes("dismiss"))).toBe(true);
  });

  it("truncates long suggestions in the action title", () => {
    const mgr = new DiagnosticsManager();
    const doc = mkDoc();
    const long = "x".repeat(200);
    mgr.setIssuesForAgent(doc.uri, "style_agent", [mkIssue({ suggestion: long })]);
    const actions = new MarkupAICodeActionProvider(mgr).provideCodeActions(
      doc,
      new vscode.Range(new vscode.Position(0, 2), new vscode.Position(0, 2)),
    ) as vscode.CodeAction[];
    const apply = actions.find((a) => a.title.includes("apply"))!;
    expect(apply.title.length).toBeLessThan(long.length);
    expect(apply.title).toContain("…");
  });
});
