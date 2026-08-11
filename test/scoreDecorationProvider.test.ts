import { describe, it, expect, vi } from "vitest";
import * as vscode from "vscode";
import { ScoreDecorationProvider, toScanUri, fromScanUri } from "../src/scoreDecorationProvider";
import { DocumentAssessment } from "../src/types";

function makeProvider(assessments: Map<string, DocumentAssessment>) {
  return new ScoreDecorationProvider((docKey) => assessments.get(docKey));
}

describe("toScanUri / fromScanUri", () => {
  it("round-trips a file uri through the scan scheme", () => {
    const uri = vscode.Uri.file("/project/readme.md");
    const scanUri = toScanUri(uri);

    expect(scanUri.scheme).toBe("markupai-scan");
    expect(scanUri.path).toBe("/project/readme.md");
    expect(fromScanUri(scanUri).toString()).toBe(uri.toString());
  });

  it("falls back to the file scheme when the scan uri carries no origin", () => {
    const bare = toScanUri(vscode.Uri.file("/project/readme.md")).with({ query: "" });
    expect(fromScanUri(bare).scheme).toBe("file");
  });
});

describe("ScoreDecorationProvider", () => {
  it("ignores uris outside the scan scheme", () => {
    const provider = makeProvider(new Map());
    expect(provider.provideFileDecoration(vscode.Uri.file("/a.md"))).toBeUndefined();
  });

  it("returns no decoration when there is no assessment", () => {
    const provider = makeProvider(new Map());
    expect(provider.provideFileDecoration(toScanUri(vscode.Uri.file("/a.md")))).toBeUndefined();
  });

  it("shows the score as a badge with a bucket color", () => {
    const uri = vscode.Uri.file("/a.md");
    const assessments = new Map([
      [uri.toString(), { risk: { high: 0, medium: 1, low: 2, total: 3 }, score: 95 }],
    ]);

    const decoration = makeProvider(assessments).provideFileDecoration(toScanUri(uri));

    expect(decoration?.badge).toBe("95");
    expect(decoration?.color?.id).toBe("charts.green");
    expect(decoration?.tooltip).toContain("95");
  });

  it.each([
    [85, "charts.yellow"],
    [55, "charts.orange"],
    [30, "charts.red"],
  ])("colors score %i with %s", (score, colorId) => {
    const uri = vscode.Uri.file("/a.md");
    const assessments = new Map([
      [uri.toString(), { risk: { high: 0, medium: 0, low: 0, total: 0 }, score }],
    ]);

    const decoration = makeProvider(assessments).provideFileDecoration(toScanUri(uri));

    expect(decoration?.badge).toBe(String(score));
    expect(decoration?.color?.id).toBe(colorId);
  });

  it("compresses a perfect score into the two-character badge limit", () => {
    const uri = vscode.Uri.file("/a.md");
    const assessments = new Map([
      [uri.toString(), { risk: { high: 0, medium: 0, low: 0, total: 0 }, score: 100 }],
    ]);

    const decoration = makeProvider(assessments).provideFileDecoration(toScanUri(uri));

    expect(decoration?.badge).toBe("💯");
  });

  it("shows a check for no score and zero issues", () => {
    const uri = vscode.Uri.file("/a.md");
    const assessments = new Map([
      [uri.toString(), { risk: { high: 0, medium: 0, low: 0, total: 0 } }],
    ]);

    const decoration = makeProvider(assessments).provideFileDecoration(toScanUri(uri));

    expect(decoration?.badge).toBe("✓");
  });

  it("shows a capped issue count for no-score assessments", () => {
    const uri = vscode.Uri.file("/a.md");
    const assessments = new Map([
      [uri.toString(), { risk: { high: 2, medium: 3, low: 11, total: 16 } }],
    ]);

    const decoration = makeProvider(assessments).provideFileDecoration(toScanUri(uri));

    expect(decoration?.badge).toBe("9+");
    expect(decoration?.color?.id).toBe("charts.red");
    expect(decoration?.tooltip).toContain("2H 3M 11L");
  });

  it("shows the exact issue count and severity color for small no-score assessments", () => {
    const uri = vscode.Uri.file("/a.md");
    const assessments = new Map([
      [uri.toString(), { risk: { high: 0, medium: 2, low: 3, total: 5 } }],
    ]);

    const decoration = makeProvider(assessments).provideFileDecoration(toScanUri(uri));

    expect(decoration?.badge).toBe("5");
    expect(decoration?.color?.id).toBe("charts.yellow");
  });

  it("colors low-only assessments blue", () => {
    const uri = vscode.Uri.file("/a.md");
    const assessments = new Map([
      [uri.toString(), { risk: { high: 0, medium: 0, low: 4, total: 4 } }],
    ]);

    const decoration = makeProvider(assessments).provideFileDecoration(toScanUri(uri));

    expect(decoration?.badge).toBe("4");
    expect(decoration?.color?.id).toBe("charts.blue");
  });

  it("disposes its event emitter", () => {
    const provider = makeProvider(new Map());
    expect(() => {
      provider.dispose();
    }).not.toThrow();
  });

  it("fires onDidChangeFileDecorations on refresh", () => {
    const provider = makeProvider(new Map());
    const listener = vi.fn();
    provider.onDidChangeFileDecorations(listener);

    provider.refresh();

    expect(listener).toHaveBeenCalledOnce();
  });
});
