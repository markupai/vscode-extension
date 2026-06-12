import * as vscode from "vscode";
import { DocumentAssessment } from "./types";
import { formatRiskSummary, getLeadSeverity, getScoreEmoji, getSeverityEmoji } from "./utils";

/**
 * Manages the status bar item for MarkupAI risk / score display.
 */
export class StatusBarManager {
  private readonly statusBarItem: vscode.StatusBarItem;

  constructor(statusBarItem: vscode.StatusBarItem) {
    this.statusBarItem = statusBarItem;
  }

  showAssessment(assessment: DocumentAssessment): void {
    const { risk, score } = assessment;

    if (typeof score === "number") {
      this.statusBarItem.text = `${getScoreEmoji(score)} MarkupAI: ${String(score)}`;
    } else if (risk.total === 0) {
      this.statusBarItem.text = "$(check) MarkupAI: No issues";
    } else {
      const lead = getLeadSeverity(risk);
      this.statusBarItem.text = `${getSeverityEmoji(lead)} MarkupAI: ${formatRiskSummary(risk)}`;
    }

    const tooltipLines = [
      "Click for details",
      "",
      `High risk: ${String(risk.high)}`,
      `Medium risk: ${String(risk.medium)}`,
      `Low risk: ${String(risk.low)}`,
    ];
    if (typeof score === "number") {
      tooltipLines.splice(1, 0, `Quality score: ${String(score)}`);
    }
    this.statusBarItem.tooltip = tooltipLines.join("\n");
    this.statusBarItem.command = "markupai.showScores";
    this.statusBarItem.backgroundColor = undefined;
    this.statusBarItem.show();
  }

  showSidebarMode(): void {
    this.statusBarItem.text = "$(layout-sidebar-left) MarkupAI";
    this.statusBarItem.tooltip = "Open the MarkupAI sidebar";
    this.statusBarItem.command = "markupai.sidebar.focus";
    this.statusBarItem.backgroundColor = undefined;
    this.statusBarItem.show();
  }

  showSignedOut(): void {
    this.statusBarItem.text = "$(key) MarkupAI: Sign in";
    this.statusBarItem.tooltip = "Click to sign in to MarkupAI";
    this.statusBarItem.command = "markupai.signIn";
    this.statusBarItem.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
    this.statusBarItem.show();
  }

  showChecking(): void {
    this.statusBarItem.text = "$(sync~spin) MarkupAI: Checking...";
    this.statusBarItem.tooltip = "Checking content...";
    this.statusBarItem.command = undefined;
    this.statusBarItem.backgroundColor = undefined;
    this.statusBarItem.show();
  }

  showDisabled(): void {
    this.statusBarItem.text = "$(circle-slash) MarkupAI: Disabled";
    this.statusBarItem.tooltip = "MarkupAI issues are disabled. Right-click to enable.";
    this.statusBarItem.command = "markupai.enableIssues";
    this.statusBarItem.backgroundColor = undefined;
    this.statusBarItem.show();
  }

  showError(): void {
    this.statusBarItem.text = "⚠️ MarkupAI: Error";
    this.statusBarItem.tooltip = "An error occurred while checking content";
    this.statusBarItem.command = undefined;
    this.statusBarItem.backgroundColor = undefined;
    this.statusBarItem.show();
  }

  hide(): void {
    this.statusBarItem.hide();
  }

  update(assessment: DocumentAssessment | null): void {
    if (!assessment) {
      this.hide();
      return;
    }
    this.showAssessment(assessment);
  }
}
