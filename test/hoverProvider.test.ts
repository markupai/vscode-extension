import { describe, expect, it } from "vitest";
import * as vscode from "vscode";
import { DiagnosticsManager } from "../src/diagnostics.js";
import { MarkupAIHoverProvider } from "../src/hoverProvider.js";
import type { IssueWithId } from "../src/types.js";

function mkIssue(over: Partial<IssueWithId> = {}): IssueWithId {
  return {
    id: "i1",
    agent: "style_agent",
    confidence: 0.8,
    severity: "medium",
    explanation: "use active voice",
    position: { start: 0, end: 5 },
    ...over,
  };
}

function mkDoc(text = "hello world"): vscode.TextDocument {
  return {
    uri: vscode.Uri.file("/tmp/a.md"),
    getText: () => text,
    positionAt: (o: number) => new vscode.Position(0, o),
    offsetAt: (p: vscode.Position) => p.character,
  } as unknown as vscode.TextDocument;
}

describe("MarkupAIHoverProvider", () => {
  it("returns undefined when no issue overlaps the position", () => {
    const mgr = new DiagnosticsManager();
    const p = new MarkupAIHoverProvider(mgr);
    const hover = p.provideHover(mkDoc(), new vscode.Position(0, 10));
    expect(hover).toBeUndefined();
  });

  it("renders the explanation and suggestion in a markdown string", () => {
    const mgr = new DiagnosticsManager();
    const doc = mkDoc();
    mgr.setIssuesForAgent(doc.uri, "style_agent", [
      mkIssue({ suggestion: "rephrase", agentName: "Style" }),
    ]);
    const hover = new MarkupAIHoverProvider(mgr).provideHover(
      doc,
      new vscode.Position(0, 2),
    ) as vscode.Hover;
    const md = hover.contents as unknown as { value: string };
    expect(md.value).toContain("MarkupAI · Style");
    expect(md.value).toContain("use active voice");
    expect(md.value).toContain("rephrase");
  });

  it("omits the suggestion block when none is present", () => {
    const mgr = new DiagnosticsManager();
    const doc = mkDoc();
    mgr.setIssuesForAgent(doc.uri, "style_agent", [mkIssue()]);
    const hover = new MarkupAIHoverProvider(mgr).provideHover(
      doc,
      new vscode.Position(0, 2),
    ) as vscode.Hover;
    const md = hover.contents as unknown as { value: string };
    expect(md.value).not.toContain("Suggestion");
  });
});
