import * as vscode from "vscode";
import { ContentScores } from "./types";
import { getScoreEmoji } from "./utils";

/**
 * Manages the status bar item for MarkupAI score display.
 */
export class StatusBarManager {
  private readonly statusBarItem: vscode.StatusBarItem;

  constructor(statusBarItem: vscode.StatusBarItem) {
    this.statusBarItem = statusBarItem;
  }

  showScore(scores: ContentScores): void {
    const emoji = getScoreEmoji(scores.overall);
    this.statusBarItem.text = `${emoji} MarkupAI: ${String(scores.overall)}`;
    this.statusBarItem.tooltip = `Click to see detailed scores\n\nGrammar: ${String(scores.grammar)}\nConsistency: ${String(scores.consistency)}\nTerminology: ${String(scores.terminology)}`;
    this.statusBarItem.command = "markupai.showScores";
    this.statusBarItem.backgroundColor = undefined;
    this.statusBarItem.show();
  }

  showNoToken(): void {
    this.statusBarItem.text = "$(key) MarkupAI: Add API Token";
    this.statusBarItem.tooltip = "Click to configure your MarkupAI API token";
    this.statusBarItem.command = "markupai.configureApiToken";
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

  update(scores: ContentScores | null): void {
    if (!scores) {
      this.hide();
      return;
    }
    this.showScore(scores);
  }
}
