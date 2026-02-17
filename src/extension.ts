import * as vscode from "vscode";
import { OffsetTranslator } from "./offsetMapper";
import { MarkupAIContentChecker } from "./apiClient";
import { ContentIssue, ContentScores, StyleGuideOption, FolderScannerItem } from "./types";
import { DIALECTS, BUILT_IN_STYLE_GUIDES } from "./constants";
import {
  getConfig,
  getApiToken,
  hasApiToken,
  getDialect,
  getStyleGuide,
  getScoreEmoji,
} from "./utils";
import { DiagnosticsManager } from "./diagnosticsManager";
import { StatusBarManager } from "./statusBarManager";
import { FindingsTreeDataProvider } from "./findingsTreeProvider";
import { FolderScannerTreeDataProvider } from "./folderScannerProvider";
import { MarkupAICodeActionProvider } from "./codeActionProvider";
import { MarkupAIHoverProvider } from "./hoverProvider";

// ============================================================================
// Internal Types
// ============================================================================

interface ApplyFixArgs {
  uri: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  suggestion: string;
}

// ============================================================================
// Extension State
// ============================================================================

let diagnosticsManager: DiagnosticsManager;
let statusBar: StatusBarManager;
let findingsTreeDataProvider: FindingsTreeDataProvider;
let folderScannerTreeDataProvider: FolderScannerTreeDataProvider;
const checkDebounceTimers: Map<string, NodeJS.Timeout> = new Map();
let isEnabled = true;
let cachedStyleGuides: StyleGuideOption[] = [...BUILT_IN_STYLE_GUIDES];
const isCheckingDocument: Map<string, boolean> = new Map();
let isApplyingFix = false;

// ============================================================================
// Extension-specific Utility Functions
// ============================================================================

function isExtensionEnabled(): boolean {
  return isEnabled && getConfig().get("enabled", true);
}

// ============================================================================
// Core Functionality
// ============================================================================

async function checkDocument(
  document: vscode.TextDocument,
  showProgress: boolean = false,
  showCompletionNotification: boolean = true,
): Promise<void> {
  if (!isExtensionEnabled()) {
    diagnosticsManager.clearForDocument(document.uri);
    statusBar.update(null);
    findingsTreeDataProvider.refresh();
    return;
  }

  if (!hasApiToken()) {
    statusBar.showNoToken();
    return;
  }

  if (document.uri.scheme !== "file" && document.uri.scheme !== "untitled") {
    return;
  }

  const text = document.getText();
  if (!text.trim()) {
    diagnosticsManager.clearForDocument(document.uri);
    statusBar.update({
      grammar: 100,
      consistency: 100,
      terminology: 100,
      overall: 100,
    });
    findingsTreeDataProvider.refresh();
    return;
  }

  const docKey = document.uri.toString();
  if (isCheckingDocument.get(docKey)) {
    return;
  }

  isCheckingDocument.set(docKey, true);
  statusBar.showChecking();

  const textAtCheckStart = text;

  try {
    const checker = new MarkupAIContentChecker(getApiToken());
    let result: { issues: ContentIssue[]; scores: ContentScores };

    if (showProgress) {
      result = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "MarkupAI: Checking content...",
          cancellable: false,
        },
        async () => {
          return await checker.checkContent(text, getDialect(), getStyleGuide(), document.fileName);
        },
      );
    } else {
      result = await checker.checkContent(text, getDialect(), getStyleGuide(), document.fileName);
    }

    diagnosticsManager.setIssues(docKey, result.issues);
    diagnosticsManager.setScores(docKey, result.scores);
    diagnosticsManager.updateDiagnostics(document, result.issues, textAtCheckStart);
    statusBar.update(result.scores);
    findingsTreeDataProvider.refresh();

    if (showCompletionNotification) {
      void showCheckCompleteNotification(result.scores, result.issues.length);
    }
  } catch (error: unknown) {
    console.error("MarkupAI: Error checking content", error);

    if (showCompletionNotification) {
      const isUnauthorized =
        typeof error === "object" &&
        error !== null &&
        "statusCode" in error &&
        error.statusCode === 401;
      const errorMessage =
        error &&
        typeof error === "object" &&
        "message" in error &&
        typeof error.message === "string"
          ? error.message
          : "Unknown error";

      if (isUnauthorized) {
        vscode.window.showErrorMessage("MarkupAI: Invalid API token. Please check your settings.");
        statusBar.showNoToken();
      } else {
        vscode.window.showErrorMessage(`MarkupAI: Error checking content - ${errorMessage}`);
        statusBar.showError();
      }
    } else {
      throw error;
    }
  } finally {
    isCheckingDocument.set(docKey, false);
  }
}

async function showCheckCompleteNotification(
  scores: ContentScores,
  issueCount: number,
): Promise<void> {
  const scoreEmoji = getScoreEmoji(scores.overall);

  let statusMessage: string;
  if (scores.overall >= 90) {
    statusMessage = "Excellent!";
  } else if (scores.overall >= 70) {
    statusMessage = "Good";
  } else if (scores.overall >= 50) {
    statusMessage = "Needs Improvement";
  } else {
    statusMessage = "Needs Attention";
  }

  const message =
    `${scoreEmoji} MarkupAI Check Complete — ${statusMessage} | ` +
    `Score: ${String(scores.overall)} | ` +
    `${String(issueCount)} issue${issueCount !== 1 ? "s" : ""} found`;

  const action = await vscode.window.showInformationMessage(
    message,
    "View Details",
    "Show Findings",
  );

  if (action === "View Details") {
    vscode.commands.executeCommand("markupai.showScores");
  } else if (action === "Show Findings") {
    vscode.commands.executeCommand("markupai.findings.focus");
  }
}

function scheduleCheck(document: vscode.TextDocument): void {
  const uri = document.uri.toString();

  const existingTimer = checkDebounceTimers.get(uri);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  const delay = getConfig().get("checkDelay", 2000);
  const timer = setTimeout(() => {
    void checkDocument(document);
    checkDebounceTimers.delete(uri);
  }, delay);

  checkDebounceTimers.set(uri, timer);
}

// ============================================================================
// Commands
// ============================================================================

async function configureApiToken(): Promise<void> {
  const currentToken = getApiToken();
  const token = await vscode.window.showInputBox({
    prompt: "Enter your MarkupAI API token",
    password: true,
    value: currentToken,
    placeHolder: "Paste your API token here",
    ignoreFocusOut: true,
  });

  if (token !== undefined) {
    await getConfig().update("apiToken", token, vscode.ConfigurationTarget.Global);

    if (token.trim()) {
      vscode.window.showInformationMessage("MarkupAI: API token saved");
      await refreshStyleGuides();

      const editor = vscode.window.activeTextEditor;
      if (editor) {
        void checkDocument(editor.document, true);
      }
    } else {
      statusBar.showNoToken();
    }
  }
}

async function refreshStyleGuides(): Promise<void> {
  if (!hasApiToken()) {
    cachedStyleGuides = [...BUILT_IN_STYLE_GUIDES];
    return;
  }

  try {
    const checker = new MarkupAIContentChecker(getApiToken());
    cachedStyleGuides = await checker.fetchStyleGuides();
  } catch (error) {
    console.error("MarkupAI: Error refreshing style guides", error);
    cachedStyleGuides = [...BUILT_IN_STYLE_GUIDES];
  }
}

async function selectStyleGuide(): Promise<void> {
  if (!hasApiToken()) {
    const action = await vscode.window.showWarningMessage(
      "MarkupAI: API token required to fetch style guides",
      "Configure Token",
    );
    if (action === "Configure Token") {
      await configureApiToken();
    }
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Loading style guides...",
      cancellable: false,
    },
    async () => {
      await refreshStyleGuides();
    },
  );

  const currentStyleGuide = getStyleGuide();
  const customGuides = cachedStyleGuides.filter((g) => !g.isBuiltIn);
  const builtInGuides = cachedStyleGuides.filter((g) => g.isBuiltIn);

  const items: vscode.QuickPickItem[] = [];

  if (customGuides.length > 0) {
    items.push({
      label: "Your Style Guides",
      kind: vscode.QuickPickItemKind.Separator,
    });
    for (const guide of customGuides) {
      items.push({
        label: guide.name,
        description: guide.id === currentStyleGuide ? "✓ Selected" : "",
        detail: guide.id,
      });
    }
  }

  items.push({
    label: "Built-in Style Guides",
    kind: vscode.QuickPickItemKind.Separator,
  });
  for (const guide of builtInGuides) {
    items.push({
      label: guide.name,
      description: guide.id === currentStyleGuide ? "✓ Selected" : "",
      detail: guide.id,
    });
  }

  const selected = await vscode.window.showQuickPick(items, {
    title: "Select Style Guide",
    placeHolder: "Choose a style guide for content checking",
    canPickMany: false,
    matchOnDescription: true,
    matchOnDetail: true,
  });

  if (selected && selected.detail) {
    await getConfig().update("styleGuide", selected.detail, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(`MarkupAI: Style guide set to "${selected.label}"`);

    const editor = vscode.window.activeTextEditor;
    if (editor) {
      void checkDocument(editor.document, true);
    }
  }
}

async function selectDialect(): Promise<void> {
  const currentDialect = getDialect();
  const items: vscode.QuickPickItem[] = DIALECTS.map((d) => ({
    label: d.label,
    detail: d.value,
    picked: d.value === currentDialect,
  }));

  const selected = await vscode.window.showQuickPick(items, {
    title: "Select Dialect",
    placeHolder: "Choose your preferred English dialect",
    canPickMany: false,
  });

  if (selected && selected.detail) {
    await getConfig().update("dialect", selected.detail, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(`MarkupAI: Dialect set to "${selected.label}"`);

    const editor = vscode.window.activeTextEditor;
    if (editor) {
      void checkDocument(editor.document, true);
    }
  }
}

async function showScoresDialog(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showInformationMessage("No active editor");
    return;
  }

  const scores = diagnosticsManager.getScores(editor.document.uri.toString());
  if (!scores) {
    vscode.window.showInformationMessage("No scores available. Run a check first.");
    return;
  }

  const issues = diagnosticsManager.getIssues(editor.document.uri.toString()) || [];
  const grammarCount = issues.filter(
    (i) => i.type === "grammar" || i.category === "grammar",
  ).length;
  const consistencyCount = issues.filter(
    (i) => i.type === "consistency" || i.category === "consistency",
  ).length;
  const terminologyCount = issues.filter(
    (i) => i.type === "terminology" || i.category === "terminology",
  ).length;
  const otherCount = issues.length - grammarCount - consistencyCount - terminologyCount;

  const currentStyleGuide = getStyleGuide();
  const currentDialect = getDialect();
  const dialectLabel = DIALECTS.find((d) => d.value === currentDialect)?.label || currentDialect;
  const styleGuideLabel =
    cachedStyleGuides.find((g) => g.id === currentStyleGuide)?.name || currentStyleGuide;

  const items: vscode.QuickPickItem[] = [
    {
      label: "Scores",
      kind: vscode.QuickPickItemKind.Separator,
    },
    {
      label: `${getScoreEmoji(scores.overall)} Overall: ${String(scores.overall)}`,
      description: `${String(issues.length)} issues`,
    },
    {
      label: `${getScoreEmoji(scores.grammar)} Grammar: ${String(scores.grammar)}`,
      description: `${String(grammarCount)} issues`,
    },
    {
      label: `${getScoreEmoji(scores.consistency)} Consistency: ${String(scores.consistency)}`,
      description: `${String(consistencyCount)} issues`,
    },
    {
      label: `${getScoreEmoji(scores.terminology)} Terminology: ${String(scores.terminology)}`,
      description: `${String(terminologyCount)} issues`,
    },
  ];

  if (otherCount > 0) {
    items.push({
      label: `📋 Other: ${String(otherCount)} issues`,
    });
  }

  items.push(
    {
      label: "Settings",
      kind: vscode.QuickPickItemKind.Separator,
    },
    {
      label: "$(gear) Style Guide",
      description: styleGuideLabel,
      detail: "Click to change style guide",
    },
    {
      label: "$(globe) Dialect",
      description: dialectLabel,
      detail: "Click to change dialect",
    },
  );

  const selected = await vscode.window.showQuickPick(items, {
    title: "MarkupAI Content Scores",
    placeHolder: "Content quality scores for current document",
    canPickMany: false,
  });

  if (selected?.label.includes("Style Guide")) {
    await selectStyleGuide();
  } else if (selected?.label.includes("Dialect")) {
    await selectDialect();
  }
}

async function setMarkupAIEnabled(enabled: boolean): Promise<void> {
  isEnabled = enabled;

  await vscode.commands.executeCommand("setContext", "markupai.enabled", isEnabled);

  const config = getConfig();
  await config.update("enabled", isEnabled, vscode.ConfigurationTarget.Global);

  if (isEnabled) {
    vscode.window.showInformationMessage("MarkupAI: Issues Enabled");
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      void checkDocument(editor.document, true);
    }
  } else {
    vscode.window.showInformationMessage("MarkupAI: Issues Disabled");
    diagnosticsManager.clearAll();
    findingsTreeDataProvider.refresh();
    statusBar.showDisabled();
  }
}

// ============================================================================
// Bulk File Checking
// ============================================================================

async function checkMultipleFiles(files: vscode.Uri[]): Promise<void> {
  const totalFiles = files.length;
  let completed = 0;
  let failed = 0;
  const errors: string[] = [];

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `MarkupAI: Checking ${String(totalFiles)} file(s)...`,
      cancellable: false,
    },
    async (progress) => {
      for (const fileUri of files) {
        const fileName = fileUri.path.split("/").pop() || fileUri.path;
        progress.report({
          message: `Checking ${fileName} (${String(completed + 1)}/${String(totalFiles)})`,
          increment: (1 / totalFiles) * 100,
        });

        try {
          const document = await vscode.workspace.openTextDocument(fileUri);
          await checkDocument(document, false, false);
          completed++;
        } catch (error: unknown) {
          failed++;
          const errorMessage =
            error &&
            typeof error === "object" &&
            "message" in error &&
            typeof error.message === "string"
              ? error.message
              : "Unknown error";
          errors.push(`${fileName}: ${errorMessage}`);
          console.error(`MarkupAI: Error checking ${fileName}`, error);
        }
      }
    },
  );

  folderScannerTreeDataProvider.refresh();
  findingsTreeDataProvider.refresh();

  let message = `MarkupAI: Checked ${String(completed)} file(s)`;
  if (failed > 0) {
    message += `, ${String(failed)} failed`;
  }

  if (failed === 0) {
    const action = await vscode.window.showInformationMessage(message, "View Findings");
    if (action === "View Findings") {
      vscode.commands.executeCommand("markupai.findings.focus");
    }
  } else {
    const action = await vscode.window.showWarningMessage(message, "View Findings", "Show Errors");
    if (action === "View Findings") {
      vscode.commands.executeCommand("markupai.findings.focus");
    } else if (action === "Show Errors") {
      const errorMessage = errors.join("\n");
      vscode.window.showErrorMessage(`Errors:\n${errorMessage}`);
    }
  }
}

// ============================================================================
// Activation
// ============================================================================

export function activate(context: vscode.ExtensionContext) {
  console.log("MarkupAI extension is now active!");

  // Initialize diagnostic collection
  const diagnosticCollection = vscode.languages.createDiagnosticCollection("markupai");
  context.subscriptions.push(diagnosticCollection);

  // Initialize managers
  diagnosticsManager = new DiagnosticsManager(diagnosticCollection);

  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.name = "MarkupAI Score";
  context.subscriptions.push(statusBarItem);
  statusBar = new StatusBarManager(statusBarItem);

  // Set initial enabled state
  isEnabled = getConfig().get("enabled", true);
  vscode.commands.executeCommand("setContext", "markupai.enabled", isEnabled);
  vscode.commands.executeCommand("setContext", "markupai.showAllFiles", true);

  // Fetch style guides on startup
  if (hasApiToken()) {
    refreshStyleGuides().catch((error: unknown) => {
      console.error("MarkupAI: Failed to fetch style guides on startup", error);
    });
  }

  // Initialize Findings TreeView
  findingsTreeDataProvider = new FindingsTreeDataProvider(() => diagnosticsManager.getAllIssues());
  const findingsTreeView = vscode.window.createTreeView("markupai.findings", {
    treeDataProvider: findingsTreeDataProvider,
    showCollapseAll: true,
  });
  context.subscriptions.push(findingsTreeView);

  // Initialize Folder Scanner TreeView
  folderScannerTreeDataProvider = new FolderScannerTreeDataProvider(() => {
    const scores = new Map<string, ContentScores>();
    diagnosticsManager.getAllIssues().forEach((_, docKey) => {
      const s = diagnosticsManager.getScores(docKey);
      if (s) {
        scores.set(docKey, s);
      }
    });
    return scores;
  });
  const folderScannerTreeView = vscode.window.createTreeView("markupai.folderScanner", {
    treeDataProvider: folderScannerTreeDataProvider,
    showCollapseAll: true,
  });
  context.subscriptions.push(folderScannerTreeView);

  // Refresh folder scanner after workspace is ready
  setTimeout(() => {
    if (!folderScannerTreeDataProvider.hasFolder()) {
      folderScannerTreeDataProvider.initializeFromWorkspace();
    }
    folderScannerTreeDataProvider.refresh();
  }, 500);

  // Listen for workspace folder changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      folderScannerTreeDataProvider.initializeFromWorkspace();
      folderScannerTreeDataProvider.refresh();
    }),
  );

  // Update tree view title with issue count
  const updateTreeViewTitle = () => {
    const count = findingsTreeDataProvider.getTotalIssueCount();
    const filters = findingsTreeDataProvider.getFilters();
    let title = `Findings (${String(count)})`;
    if (filters.severity || filters.category) {
      const activeFilters = [filters.severity, filters.category].filter(Boolean).join(", ");
      title += ` - Filtered: ${activeFilters}`;
    }
    findingsTreeView.title = title;
  };

  // Register findings panel commands
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "markupai.goToIssue",
      async (uri: vscode.Uri, issue: ContentIssue) => {
        const document = await vscode.workspace.openTextDocument(uri);
        const editor = await vscode.window.showTextDocument(document);
        const startPos = document.positionAt(issue.startIndex);
        const endPos = document.positionAt(issue.endIndex);
        const range = new vscode.Range(startPos, endPos);
        editor.selection = new vscode.Selection(range.start, range.end);
        editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("markupai.refreshFindings", () => {
      findingsTreeDataProvider.refresh();
      updateTreeViewTitle();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("markupai.filterBySeverity", async () => {
      const severities = findingsTreeDataProvider.getAvailableSeverities();
      if (severities.length === 0) {
        vscode.window.showInformationMessage("No issues found to filter");
        return;
      }

      const items = severities.map((s) => ({
        label: s === "high" ? "🔴 High" : s === "medium" ? "🟡 Medium" : "🔵 Low",
        value: s,
      }));
      items.unshift({ label: "All Severities", value: "" });

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: "Select severity to filter",
      });

      if (selected) {
        findingsTreeDataProvider.setSeverityFilter(selected.value || null);
        updateTreeViewTitle();
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("markupai.filterByCategory", async () => {
      const categories = findingsTreeDataProvider.getAvailableCategories();
      if (categories.length === 0) {
        vscode.window.showInformationMessage("No issues found to filter");
        return;
      }

      const items = categories.map((c) => ({
        label: c.charAt(0).toUpperCase() + c.slice(1),
        value: c,
      }));
      items.unshift({ label: "All Categories", value: "" });

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: "Select category to filter",
      });

      if (selected) {
        findingsTreeDataProvider.setCategoryFilter(selected.value || null);
        updateTreeViewTitle();
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("markupai.clearFilters", () => {
      findingsTreeDataProvider.clearFilters();
      updateTreeViewTitle();
      vscode.window.showInformationMessage("Filters cleared");
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("markupai.showAllFindings", () => {
      findingsTreeDataProvider.setShowAllFiles(true);
      updateTreeViewTitle();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("markupai.showCurrentFileFindings", () => {
      findingsTreeDataProvider.setShowAllFiles(false);
      updateTreeViewTitle();
    }),
  );

  // ============================================================================
  // Folder Scanner Commands
  // ============================================================================

  context.subscriptions.push(
    vscode.commands.registerCommand("markupai.selectFolder", async () => {
      const currentFolder = folderScannerTreeDataProvider.getRootFolder();

      const folderUri = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: "Select Folder to Scan",
        title: "Select a different folder to scan (current workspace is auto-loaded)",
        defaultUri: currentFolder || undefined,
      });

      if (folderUri && folderUri[0]) {
        folderScannerTreeDataProvider.setRootFolder(folderUri[0]);
        const folderName = folderUri[0].path.split("/").pop() || folderUri[0].fsPath;
        vscode.window.showInformationMessage(`MarkupAI: Now scanning "${folderName}"`);
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("markupai.refreshFolderScanner", () => {
      folderScannerTreeDataProvider.refresh();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("markupai.openFile", async (uri: vscode.Uri) => {
      const document = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(document);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("markupai.toggleFileSelection", (item: FolderScannerItem) => {
      folderScannerTreeDataProvider.toggleFileSelection(item);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("markupai.checkAllFiles", async () => {
      if (!hasApiToken()) {
        const action = await vscode.window.showWarningMessage(
          "MarkupAI: API token required",
          "Configure Token",
        );
        if (action === "Configure Token") {
          await configureApiToken();
        }
        return;
      }

      const files = await folderScannerTreeDataProvider.getAllFiles();
      if (files.length === 0) {
        vscode.window.showInformationMessage("No supported files found in selected folder");
        return;
      }

      await checkMultipleFiles(files);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("markupai.checkSelectedFiles", async () => {
      if (!hasApiToken()) {
        const action = await vscode.window.showWarningMessage(
          "MarkupAI: API token required",
          "Configure Token",
        );
        if (action === "Configure Token") {
          await configureApiToken();
        }
        return;
      }

      const selectedFiles = folderScannerTreeDataProvider.getSelectedFiles();
      if (selectedFiles.length === 0) {
        vscode.window.showInformationMessage(
          "No files selected. Click on files to select them, then run this command.",
        );
        return;
      }

      await checkMultipleFiles(selectedFiles);
    }),
  );

  // Register Code Actions Provider
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      { scheme: "file" },
      new MarkupAICodeActionProvider(),
      {
        providedCodeActionKinds: MarkupAICodeActionProvider.providedCodeActionKinds,
      },
    ),
  );

  // Register Hover Provider
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(
      { scheme: "file" },
      new MarkupAIHoverProvider((uri) => diagnosticsManager.getDiagnosticsForUri(uri)),
    ),
  );

  // Register Commands
  context.subscriptions.push(
    vscode.commands.registerCommand("markupai.checkContent", () => {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        void checkDocument(editor.document, true);
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("markupai.toggleEnabled", async () => {
      await setMarkupAIEnabled(!isEnabled);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("markupai.enableIssues", async () => {
      await setMarkupAIEnabled(true);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("markupai.disableIssues", async () => {
      await setMarkupAIEnabled(false);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("markupai.disableCategory", (category: string) => {
      if (!category) {
        return;
      }

      diagnosticsManager.addDisabledCategory(category);
      const categoryLabel = category.charAt(0).toUpperCase() + category.slice(1);
      vscode.window.showInformationMessage(
        `MarkupAI: ${categoryLabel} issues are now hidden. Use "MarkupAI: Enable Category" to show them again.`,
      );

      diagnosticsManager.filterDiagnosticsByDisabledCategories();
      findingsTreeDataProvider.refresh();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("markupai.enableCategory", async () => {
      const disabledCategories = diagnosticsManager.getDisabledCategories();
      if (disabledCategories.size === 0) {
        vscode.window.showInformationMessage("MarkupAI: All categories are already enabled.");
        return;
      }

      const categories = Array.from(disabledCategories).map((cat) => ({
        label: cat.charAt(0).toUpperCase() + cat.slice(1),
        value: cat,
      }));

      const selected = await vscode.window.showQuickPick(
        categories.map((c) => c.label),
        {
          placeHolder: "Select a category to enable",
          canPickMany: true,
        },
      );

      if (selected && selected.length > 0) {
        for (const label of selected) {
          const cat = categories.find((c) => c.label === label);
          if (cat) {
            diagnosticsManager.removeDisabledCategory(cat.value);
          }
        }

        vscode.window.showInformationMessage(
          `MarkupAI: Enabled ${selected.join(", ")} issues. Run "MarkupAI - Check Content" to see them.`,
        );
        findingsTreeDataProvider.refresh();
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("markupai.showScores", showScoresDialog),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("markupai.configureApiToken", configureApiToken),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("markupai.selectStyleGuide", selectStyleGuide),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("markupai.selectDialect", selectDialect),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("markupai.applyFix", async (args: string | ApplyFixArgs) => {
      if (!args) {
        return;
      }

      const parsedArgs: ApplyFixArgs =
        typeof args === "string" ? (JSON.parse(args) as ApplyFixArgs) : args;
      const uri = vscode.Uri.parse(parsedArgs.uri);
      const range = new vscode.Range(
        new vscode.Position(parsedArgs.range.start.line, parsedArgs.range.start.character),
        new vscode.Position(parsedArgs.range.end.line, parsedArgs.range.end.character),
      );

      const document = await vscode.workspace.openTextDocument(uri);
      const oldText = document.getText();
      const startOffset = document.offsetAt(range.start);
      const endOffset = document.offsetAt(range.end);

      isApplyingFix = true;

      const edit = new vscode.WorkspaceEdit();
      edit.replace(uri, range, parsedArgs.suggestion);
      await vscode.workspace.applyEdit(edit);

      const newText = document.getText();

      const translator = new OffsetTranslator(oldText, newText);
      const docKey = uri.toString();
      const existingIssues = diagnosticsManager.getIssues(docKey);

      if (existingIssues) {
        const updatedIssues: ContentIssue[] = [];

        for (const issue of existingIssues) {
          if (
            (issue.startIndex >= startOffset && issue.startIndex < endOffset) ||
            (issue.endIndex > startOffset && issue.endIndex <= endOffset)
          ) {
            continue;
          }

          const translatedRange = translator.translateRange(issue.startIndex, issue.endIndex);

          if (translatedRange) {
            const textAtPosition = newText.substring(translatedRange.start, translatedRange.end);

            if (textAtPosition === issue.originalText) {
              updatedIssues.push({
                ...issue,
                startIndex: translatedRange.start,
                endIndex: translatedRange.end,
              });
            }
          }
        }

        diagnosticsManager.setIssues(docKey, updatedIssues);
        diagnosticsManager.updateDiagnostics(document, updatedIssues);
        findingsTreeDataProvider.refresh();
      }

      setTimeout(() => {
        isApplyingFix = false;
      }, 100);
    }),
  );

  // Document Events
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((document) => {
      // Runtime check - user can change this setting
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (getConfig().get("checkOnOpen", true)) {
        void checkDocument(document);
      }
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (isApplyingFix) {
        return;
      }

      // Runtime check - user can change this setting
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (getConfig().get("checkOnChange", false)) {
        scheduleCheck(event.document);
      }
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((document) => {
      diagnosticsManager.clearForDocument(document.uri);
      findingsTreeDataProvider.refresh();
      const timer = checkDebounceTimers.get(document.uri.toString());
      if (timer) {
        clearTimeout(timer);
        checkDebounceTimers.delete(document.uri.toString());
      }
    }),
  );

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) {
        const scores = diagnosticsManager.getScores(editor.document.uri.toString());
        if (scores) {
          statusBar.update(scores);
        } else if (!hasApiToken()) {
          statusBar.showNoToken();
        } else {
          void checkDocument(editor.document);
        }
      } else {
        statusBar.hide();
      }
    }),
  );

  // Configuration change listener
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("markupai.enabled")) {
        isEnabled = getConfig().get("enabled", true);
        vscode.commands.executeCommand("setContext", "markupai.enabled", isEnabled);

        // Runtime check - user can change this setting
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (!isEnabled) {
          diagnosticsManager.clearAll();
          findingsTreeDataProvider.refresh();
          statusBar.showDisabled();
        } else {
          const editor = vscode.window.activeTextEditor;
          if (editor) {
            void checkDocument(editor.document);
          }
        }
      }

      if (event.affectsConfiguration("markupai.apiToken")) {
        void refreshStyleGuides();
      }
    }),
  );

  // Initial setup
  if (hasApiToken()) {
    void refreshStyleGuides();
  }

  // Check currently open document on activation
  if (vscode.window.activeTextEditor) {
    if (hasApiToken()) {
      void checkDocument(vscode.window.activeTextEditor.document);
    } else {
      statusBar.showNoToken();
    }
  } else if (!hasApiToken()) {
    statusBar.showNoToken();
  }
}

// This method is called when your extension is deactivated
export function deactivate() {
  for (const timer of checkDebounceTimers.values()) {
    clearTimeout(timer);
  }
  checkDebounceTimers.clear();
}
