import { describe, expect, it } from "vitest";
import * as vscode from "vscode";
import { DiagnosticsManager, toDiagnostic } from "../src/diagnostics.js";
import type { IssueWithId } from "../src/types.js";

function mkIssue(over: Partial<IssueWithId> = {}): IssueWithId {
  return {
    id: "id-1",
    agent: "style_agent",
    confidence: 0.9,
    severity: "medium",
    explanation: "use active voice",
    position: { start: 0, end: 5 },
    ...over,
  };
}

function mkDoc(text = "hello world") {
  const uri = vscode.Uri.file("/tmp/foo.md");
  return {
    uri,
    getText: () => text,
    positionAt: (o: number) => new vscode.Position(0, o),
    offsetAt: (p: vscode.Position) => p.character,
  } as unknown as vscode.TextDocument;
}

describe("DiagnosticsManager", () => {
  it("sets and clears issues per agent", () => {
    const mgr = new DiagnosticsManager();
    const uri = vscode.Uri.file("/tmp/a.md");
    mgr.setIssuesForAgent(uri, "style_agent", [mkIssue()]);
    mgr.setIssuesForAgent(uri, "terminology", [mkIssue({ id: "id-2", agent: "terminology" })]);
    expect(mgr.getAllIssues(uri)).toHaveLength(2);
    mgr.clear(uri);
    expect(mgr.getAllIssues(uri)).toHaveLength(0);
    mgr.dispose();
  });

  it("re-scanning the same agent replaces its issues but keeps others", () => {
    const mgr = new DiagnosticsManager();
    const uri = vscode.Uri.file("/tmp/a.md");
    mgr.setIssuesForAgent(uri, "style_agent", [mkIssue()]);
    mgr.setIssuesForAgent(uri, "terminology", [mkIssue({ id: "t1", agent: "terminology" })]);
    mgr.setIssuesForAgent(uri, "style_agent", []); // replace with empty
    const remaining = mgr.getAllIssues(uri);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].agent).toBe("terminology");
  });

  it("clear() with no argument wipes everything", () => {
    const mgr = new DiagnosticsManager();
    const u1 = vscode.Uri.file("/tmp/a.md");
    const u2 = vscode.Uri.file("/tmp/b.md");
    mgr.setIssuesForAgent(u1, "x", [mkIssue()]);
    mgr.setIssuesForAgent(u2, "x", [mkIssue()]);
    mgr.clear();
    expect(mgr.getAllIssues(u1)).toHaveLength(0);
    expect(mgr.getAllIssues(u2)).toHaveLength(0);
  });

  it("getIssuesAt returns issues overlapping a cursor position", () => {
    const mgr = new DiagnosticsManager();
    const doc = mkDoc();
    mgr.setIssuesForAgent(doc.uri, "style_agent", [
      mkIssue({ position: { start: 0, end: 5 } }),
      mkIssue({ id: "id-2", position: { start: 7, end: 10 } }),
    ]);
    const hits = mgr.getIssuesAt(doc.uri, new vscode.Position(0, 3), doc);
    expect(hits).toHaveLength(1);
    expect(hits[0].id).toBe("id-1");
  });

  it("getIssuesAt returns empty for unknown uri", () => {
    const mgr = new DiagnosticsManager();
    const hits = mgr.getIssuesAt(vscode.Uri.file("/tmp/none"), new vscode.Position(0, 0), mkDoc());
    expect(hits).toEqual([]);
  });
});

describe("toDiagnostic", () => {
  it("maps severity correctly", () => {
    expect(toDiagnostic(mkIssue({ severity: "critical" })).severity).toBe(
      vscode.DiagnosticSeverity.Error,
    );
    expect(toDiagnostic(mkIssue({ severity: "high" })).severity).toBe(
      vscode.DiagnosticSeverity.Error,
    );
    expect(toDiagnostic(mkIssue({ severity: "medium" })).severity).toBe(
      vscode.DiagnosticSeverity.Warning,
    );
    expect(toDiagnostic(mkIssue({ severity: "low" })).severity).toBe(
      vscode.DiagnosticSeverity.Information,
    );
  });

  it("uses the agentName as the code when provided", () => {
    const d = toDiagnostic(mkIssue({ agentName: "Acrolinx" }));
    expect(d.code).toBe("Acrolinx");
  });
});
