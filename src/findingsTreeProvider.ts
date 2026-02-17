import * as vscode from "vscode";
import { ContentIssue, FindingTreeItem } from "./types";

/**
 * Provides tree data for the Findings panel showing content issues.
 */
export class FindingsTreeDataProvider implements vscode.TreeDataProvider<FindingTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<FindingTreeItem | undefined | null> =
    new vscode.EventEmitter<FindingTreeItem | undefined | null>();
  readonly onDidChangeTreeData: vscode.Event<FindingTreeItem | undefined | null> =
    this._onDidChangeTreeData.event;

  private severityFilter: string | null = null;
  private categoryFilter: string | null = null;
  private showAllFiles: boolean = true;

  constructor(private getDocumentIssues: () => Map<string, ContentIssue[]>) {}

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  setSeverityFilter(severity: string | null): void {
    this.severityFilter = severity;
    this.refresh();
  }

  setCategoryFilter(category: string | null): void {
    this.categoryFilter = category;
    this.refresh();
  }

  clearFilters(): void {
    this.severityFilter = null;
    this.categoryFilter = null;
    this.refresh();
  }

  setShowAllFiles(showAll: boolean): void {
    this.showAllFiles = showAll;
    vscode.commands.executeCommand("setContext", "markupai.showAllFiles", showAll);
    this.refresh();
  }

  getFilters(): { severity: string | null; category: string | null } {
    return { severity: this.severityFilter, category: this.categoryFilter };
  }

  getTreeItem(element: FindingTreeItem): vscode.TreeItem {
    if (element.type === "file") {
      const treeItem = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.Expanded);
      treeItem.iconPath = vscode.ThemeIcon.File;
      treeItem.resourceUri = element.uri;
      treeItem.description = `${String(element.children?.length || 0)} issues`;
      return treeItem;
    } else {
      if (!element.issue) {
        return new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
      }
      const issue = element.issue;
      const treeItem = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);

      if (issue.severity === "high") {
        treeItem.iconPath = new vscode.ThemeIcon(
          "circle-filled",
          new vscode.ThemeColor("charts.red"),
        );
      } else if (issue.severity === "medium") {
        treeItem.iconPath = new vscode.ThemeIcon(
          "circle-filled",
          new vscode.ThemeColor("charts.yellow"),
        );
      } else {
        treeItem.iconPath = new vscode.ThemeIcon(
          "circle-filled",
          new vscode.ThemeColor("charts.blue"),
        );
      }

      treeItem.description = issue.category || issue.type;

      const tooltip = new vscode.MarkdownString();
      tooltip.appendMarkdown(`**${issue.category || issue.type}**\n\n`);
      tooltip.appendMarkdown(`${issue.message}\n\n`);
      if (issue.suggestion) {
        tooltip.appendMarkdown(`**Suggestion:** \`${issue.suggestion}\``);
      }
      treeItem.tooltip = tooltip;

      treeItem.command = {
        command: "markupai.goToIssue",
        title: "Go to Issue",
        arguments: [element.uri, issue],
      };

      return treeItem;
    }
  }

  getChildren(element?: FindingTreeItem): Thenable<FindingTreeItem[]> {
    if (!element) {
      return Promise.resolve(this.getFileItems());
    } else if (element.type === "file") {
      return Promise.resolve(element.children || []);
    }
    return Promise.resolve([]);
  }

  private getFileItems(): FindingTreeItem[] {
    const items: FindingTreeItem[] = [];
    const activeEditor = vscode.window.activeTextEditor;
    const documentIssues = this.getDocumentIssues();

    const urisToShow: string[] = [];

    if (this.showAllFiles) {
      documentIssues.forEach((_, uriString) => {
        urisToShow.push(uriString);
      });
    } else {
      if (activeEditor) {
        const currentUri = activeEditor.document.uri.toString();
        if (documentIssues.has(currentUri)) {
          urisToShow.push(currentUri);
        }
      }
    }

    for (const uriString of urisToShow) {
      const uri = vscode.Uri.parse(uriString);
      let issues = documentIssues.get(uriString) || [];

      if (this.severityFilter) {
        issues = issues.filter((i) => i.severity === this.severityFilter);
      }
      if (this.categoryFilter) {
        issues = issues.filter(
          (i) => i.category === this.categoryFilter || i.type === this.categoryFilter,
        );
      }

      if (issues.length === 0) {
        continue;
      }

      const document = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uriString);

      const issueItems: FindingTreeItem[] = issues.map((issue) => {
        let label = issue.message;
        if (label.length > 80) {
          label = label.substring(0, 77) + "...";
        }

        if (document) {
          const position = document.positionAt(issue.startIndex);
          label += ` (Ln ${String(position.line + 1)})`;
        }

        return {
          type: "issue" as const,
          uri: uri,
          issue: issue,
          label: label,
        };
      });

      const fileName = uri.path.split("/").pop() || uri.path;

      items.push({
        type: "file",
        uri: uri,
        label: fileName,
        children: issueItems,
      });
    }

    return items;
  }

  getTotalIssueCount(): number {
    let count = 0;
    const documentIssues = this.getDocumentIssues();
    documentIssues.forEach((issues) => {
      let filtered = issues;
      if (this.severityFilter) {
        filtered = filtered.filter((i) => i.severity === this.severityFilter);
      }
      if (this.categoryFilter) {
        filtered = filtered.filter(
          (i) => i.category === this.categoryFilter || i.type === this.categoryFilter,
        );
      }
      count += filtered.length;
    });
    return count;
  }

  getAvailableCategories(): string[] {
    const categories = new Set<string>();
    const documentIssues = this.getDocumentIssues();
    documentIssues.forEach((issues) => {
      issues.forEach((issue) => {
        if (issue.category) {
          categories.add(issue.category);
        }
        categories.add(issue.type);
      });
    });
    return Array.from(categories);
  }

  getAvailableSeverities(): string[] {
    const severities = new Set<string>();
    const documentIssues = this.getDocumentIssues();
    documentIssues.forEach((issues) => {
      issues.forEach((issue) => {
        severities.add(issue.severity);
      });
    });
    return Array.from(severities);
  }
}
