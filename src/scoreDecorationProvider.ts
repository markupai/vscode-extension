import * as vscode from "vscode";
import { DocumentAssessment } from "./types";
import { formatRiskSummary } from "./utils";

/**
 * Custom scheme for Folder Scanner tree items so score decorations apply
 * only there and never leak into the Explorer, tabs, or other views that
 * show the same file:// resources.
 */
export const SCAN_DECORATION_SCHEME = "markupai-scan";

/** Wraps a document uri for display in the Folder Scanner. */
export function toScanUri(uri: vscode.Uri): vscode.Uri {
  return uri.with({ scheme: SCAN_DECORATION_SCHEME, query: uri.scheme });
}

/** Recovers the real document uri from a Folder Scanner display uri. */
export function fromScanUri(uri: vscode.Uri): vscode.Uri {
  return uri.with({ scheme: uri.query || "file", query: "" });
}

function scoreColorId(score: number): string {
  if (score >= 90) {
    return "charts.green";
  }
  if (score >= 70) {
    return "charts.yellow";
  }
  if (score >= 50) {
    return "charts.orange";
  }
  return "charts.red";
}

function severityColorId(risk: DocumentAssessment["risk"]): string {
  if (risk.high > 0) {
    return "charts.red";
  }
  if (risk.medium > 0) {
    return "charts.yellow";
  }
  return "charts.blue";
}

/**
 * Renders check results as right-aligned badges in the Folder Scanner
 * (score, or issue count when the organization has no numeric scoring),
 * replacing the left-aligned tree item description that drifted with each
 * file name's length. Decorations re-render on `refresh()` without a tree
 * redraw.
 */
export class ScoreDecorationProvider implements vscode.FileDecorationProvider, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<undefined>();
  readonly onDidChangeFileDecorations = this.changed.event;

  constructor(private readonly getAssessment: (docKey: string) => DocumentAssessment | undefined) {}

  refresh(): void {
    this.changed.fire(undefined);
  }

  dispose(): void {
    this.changed.dispose();
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (uri.scheme !== SCAN_DECORATION_SCHEME) {
      return undefined;
    }
    const assessment = this.getAssessment(fromScanUri(uri).toString());
    if (!assessment) {
      return undefined;
    }

    const { score, risk } = assessment;
    if (typeof score === "number") {
      return {
        // Badges are capped at two characters; a perfect score gets 💯.
        badge: score >= 100 ? "💯" : String(Math.max(0, Math.round(score))),
        color: new vscode.ThemeColor(scoreColorId(score)),
        tooltip: `Markup AI score: ${String(score)}`,
      };
    }
    if (risk.total === 0) {
      return {
        badge: "✓",
        color: new vscode.ThemeColor("charts.green"),
        tooltip: "Markup AI: no issues found",
      };
    }
    return {
      badge: risk.total > 9 ? "9+" : String(risk.total),
      color: new vscode.ThemeColor(severityColorId(risk)),
      tooltip: `Markup AI: ${formatRiskSummary(risk)}`,
    };
  }
}
