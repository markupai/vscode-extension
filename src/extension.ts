import * as vscode from "vscode";
import { OffsetTranslator } from "./offsetMapper";
import { AuthManager, promptForToken } from "./auth";
import { isBrowserSignInAvailable, runBrowserSignIn } from "./browserSignIn";
import { StyleAgentClient, StyleAgentConfig, AuthError } from "./styleAgentApi";
import { toCheckResult } from "./resultMapper";
import { ContentIssue, DocumentAssessment, StyleGuideOption, FolderScannerItem } from "./types";
import { OAUTH_PROVIDER, USER_MESSAGE_PREFIX } from "./constants";
import {
  getConfig,
  getApiBaseUrl,
  getStyleGuideId,
  isSidebarMode,
  getScoreEmoji,
  getSeverityEmoji,
  getLeadSeverity,
  formatRiskSummary,
  isWebEnvironment,
  isSupportedScheme,
  isCorsOrNetworkError,
  SUPPORTED_SCHEMES,
} from "./utils";
import { DiagnosticsManager } from "./diagnosticsManager";
import { SidebarViewProvider } from "./sidebar/sidebarViewProvider";
import { SidebarBridge } from "./sidebar/sidebarBridge";
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
let auth: AuthManager;
const checkDebounceTimers: Map<string, NodeJS.Timeout> = new Map();
let isEnabled = true;
let cachedStyleGuides: StyleGuideOption[] = [];
let orgConfig: StyleAgentConfig | null = null;
const isCheckingDocument: Map<string, boolean> = new Map();
let isApplyingFix = false;
let corsWarningShown = false;
let styleAgentDisabledWarningShown = false;

// ============================================================================
// Extension-specific Utility Functions
// ============================================================================

function isExtensionEnabled(): boolean {
  return isEnabled && getConfig().get("enabled", true);
}

function createClient(): StyleAgentClient {
  return new StyleAgentClient({
    baseUrl: getApiBaseUrl(),
    getToken: () => auth.getValidToken(),
  });
}

function resetSessionCaches(): void {
  orgConfig = null;
  cachedStyleGuides = [];
  styleAgentDisabledWarningShown = false;
}

// ============================================================================
// Core Functionality
// ============================================================================

/**
 * Fetches and caches the org config. Returns false (and warns) when the
 * Style Agent is disabled for the organization.
 */
async function ensureStyleAgentAvailable(): Promise<boolean> {
  if (!orgConfig) {
    try {
      orgConfig = await createClient().getConfig();
    } catch (error) {
      // Config is a gate, not a hard dependency — let the check call
      // surface a meaningful error instead.
      console.error("MarkupAI: Error fetching org config", error);
      return true;
    }
  }

  if (orgConfig.style_agent === "disabled") {
    if (!styleAgentDisabledWarningShown) {
      styleAgentDisabledWarningShown = true;
      void vscode.window.showWarningMessage(
        `${USER_MESSAGE_PREFIX}the Style Agent is not enabled for your organization.`,
      );
    }
    return false;
  }
  return true;
}

/**
 * Configured style guide ID, or the organization's default style guide
 * (is_default in the style guide list, e.g. "Main") when none is set.
 */
async function resolveStyleGuideId(): Promise<string | undefined> {
  const configured = getStyleGuideId();
  if (configured) {
    return configured;
  }
  if (cachedStyleGuides.length === 0) {
    await refreshStyleGuides();
  }
  return cachedStyleGuides.find((g) => g.isDefault)?.id;
}

async function runContentCheck(
  text: string,
  document: vscode.TextDocument,
  showProgress: boolean,
): Promise<{ issues: ContentIssue[]; assessment: DocumentAssessment }> {
  const client = createClient();
  const fileName = document.uri.path.split("/").pop() || document.uri.path;
  const styleGuideId = await resolveStyleGuideId();

  const check = async () => {
    const workflow = await client.runCheck({
      text,
      ...(styleGuideId ? { styleGuideId } : {}),
      documentName: fileName,
      documentRef: document.uri.toString(),
    });
    return toCheckResult(workflow, text);
  };

  if (!showProgress) {
    return check();
  }

  return await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "MarkupAI: Checking content...",
      cancellable: false,
    },
    () => check(),
  );
}

function handleCheckError(error: unknown, showCompletionNotification: boolean): void {
  console.error("MarkupAI: Error checking content", error);

  if (isWebEnvironment() && isCorsOrNetworkError(error)) {
    if (!corsWarningShown) {
      corsWarningShown = true;
      void vscode.window.showWarningMessage(
        "MarkupAI: API requests are blocked by the browser (CORS). " +
          "Content checking is not yet supported in VS Code for the Web. " +
          "Please use VS Code Desktop for full functionality.",
        "Dismiss",
      );
    }
    statusBar.showError();
    return;
  }

  if (error instanceof AuthError) {
    statusBar.showSignedOut();
    void vscode.window
      .showErrorMessage(`${USER_MESSAGE_PREFIX}your session has expired.`, "Sign In")
      .then((action) => {
        if (action === "Sign In") {
          void vscode.commands.executeCommand("markupai.signIn");
        }
      });
    return;
  }

  if (!showCompletionNotification) {
    throw error;
  }

  const errorMessage =
    error && typeof error === "object" && "message" in error && typeof error.message === "string"
      ? error.message
      : "Unknown error";

  vscode.window.showErrorMessage(`MarkupAI: Error checking content - ${errorMessage}`);
  statusBar.showError();
}

async function checkDocument(
  document: vscode.TextDocument,
  showProgress: boolean = false,
  showCompletionNotification: boolean = true,
): Promise<void> {
  if (isSidebarMode()) {
    return;
  }

  if (!isExtensionEnabled()) {
    diagnosticsManager.clearForDocument(document.uri);
    statusBar.update(null);
    findingsTreeDataProvider.refresh();
    return;
  }

  if (!(await auth.isSignedIn())) {
    statusBar.showSignedOut();
    return;
  }

  if (!isSupportedScheme(document.uri.scheme)) {
    return;
  }

  const text = document.getText();
  if (!text.trim()) {
    diagnosticsManager.clearForDocument(document.uri);
    statusBar.update({ risk: { high: 0, medium: 0, low: 0, total: 0 } });
    findingsTreeDataProvider.refresh();
    return;
  }

  if (!(await ensureStyleAgentAvailable())) {
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
    const result = await runContentCheck(text, document, showProgress);

    diagnosticsManager.setIssues(docKey, result.issues);
    diagnosticsManager.setAssessment(docKey, result.assessment);
    diagnosticsManager.updateDiagnostics(document, result.issues, textAtCheckStart);
    statusBar.update(result.assessment);
    findingsTreeDataProvider.refresh();

    if (showCompletionNotification) {
      void showCheckCompleteNotification(result.assessment);
    }
  } catch (error: unknown) {
    handleCheckError(error, showCompletionNotification);
  } finally {
    isCheckingDocument.set(docKey, false);
  }
}

function scoreStatusLabel(score: number): string {
  if (score >= 90) {
    return "Excellent!";
  }
  if (score >= 70) {
    return "Good";
  }
  if (score >= 50) {
    return "Needs Improvement";
  }
  return "Needs Attention";
}

function buildCheckCompleteMessage(assessment: DocumentAssessment): string {
  const { risk, score } = assessment;
  const issueCount = `${String(risk.total)} issue${risk.total === 1 ? "" : "s"}`;

  if (typeof score === "number") {
    return (
      `${getScoreEmoji(score)} MarkupAI Check Complete — ${scoreStatusLabel(score)} | ` +
      `Score: ${String(score)} | ${issueCount} found`
    );
  }
  if (risk.total === 0) {
    return "✅ MarkupAI Check Complete — no issues found";
  }
  const emoji = getSeverityEmoji(getLeadSeverity(risk));
  return `${emoji} MarkupAI Check Complete — ${issueCount} (${formatRiskSummary(risk)})`;
}

async function showCheckCompleteNotification(assessment: DocumentAssessment): Promise<void> {
  const action = await vscode.window.showInformationMessage(
    buildCheckCompleteMessage(assessment),
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
// Authentication Commands
// ============================================================================

async function pickSignInMethod(): Promise<"browser" | "paste" | undefined> {
  if (!isBrowserSignInAvailable()) {
    return "paste";
  }

  const items: vscode.QuickPickItem[] = [
    {
      label: "$(globe) Sign in with browser",
      detail: "Opens markup.ai in your browser to sign in",
    },
    {
      label: "$(key) Paste access token or API key",
      detail: "For tokens obtained elsewhere (JWT or mat_… API key)",
    },
  ];
  const selected = await vscode.window.showQuickPick(items, {
    title: "MarkupAI Sign In",
    placeHolder: "Choose how to sign in",
  });
  if (!selected) {
    return undefined;
  }
  return selected.label.includes("browser") ? "browser" : "paste";
}

async function browserSignIn(): Promise<boolean> {
  try {
    return await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "MarkupAI: Complete the sign-in in your browser…",
        cancellable: false,
      },
      async () => {
        const result = await runBrowserSignIn({
          apiBaseUrl: getApiBaseUrl(),
          provider: OAUTH_PROVIDER,
        });
        await auth.setSession(result);
        return true;
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "sign-in failed.";
    const action = await vscode.window.showErrorMessage(message, "Paste token instead");
    if (action === "Paste token instead") {
      return promptForToken(auth);
    }
    return false;
  }
}

async function signIn(): Promise<void> {
  const method = await pickSignInMethod();
  if (!method) {
    return;
  }

  const signedIn = method === "browser" ? await browserSignIn() : await promptForToken(auth);
  if (!signedIn) {
    return;
  }

  vscode.window.showInformationMessage(`${USER_MESSAGE_PREFIX}signed in.`);
  resetSessionCaches();
  await refreshStyleGuides();

  const editor = vscode.window.activeTextEditor;
  if (editor) {
    void checkDocument(editor.document, true);
  }
}

async function signOut(): Promise<void> {
  await auth.signOut();
  resetSessionCaches();
  diagnosticsManager.clearAll();
  findingsTreeDataProvider.refresh();
  statusBar.showSignedOut();
  vscode.window.showInformationMessage(`${USER_MESSAGE_PREFIX}signed out.`);
}

/**
 * Guard for commands that need a session: prompts to sign in when needed.
 * Returns true when signed in.
 */
async function requireSignIn(): Promise<boolean> {
  if (await auth.isSignedIn()) {
    return true;
  }
  const action = await vscode.window.showWarningMessage(
    `${USER_MESSAGE_PREFIX}sign in to check content.`,
    "Sign In",
  );
  if (action === "Sign In") {
    await signIn();
    return auth.isSignedIn();
  }
  return false;
}

// ============================================================================
// Style Guide Commands
// ============================================================================

async function refreshStyleGuides(): Promise<void> {
  if (!(await auth.isSignedIn())) {
    cachedStyleGuides = [];
    return;
  }

  try {
    const guides = await createClient().listStyleGuides();
    cachedStyleGuides = guides.map((g) => ({
      id: g.id,
      name: g.display_name,
      isDefault: g.is_default,
      ...(g.language_name
        ? { language: [g.language_name, g.language_variant_name].filter(Boolean).join(" — ") }
        : {}),
    }));
  } catch (error) {
    console.error("MarkupAI: Error refreshing style guides", error);
    cachedStyleGuides = [];

    if (isWebEnvironment() && isCorsOrNetworkError(error) && !corsWarningShown) {
      corsWarningShown = true;
      void vscode.window.showWarningMessage(
        "MarkupAI: API requests are blocked by the browser (CORS). " +
          "Content checking is not yet supported in VS Code for the Web. " +
          "Please use VS Code Desktop for full functionality.",
        "Dismiss",
      );
    }
  }
}

async function selectStyleGuide(): Promise<void> {
  if (!(await requireSignIn())) {
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

  if (cachedStyleGuides.length === 0) {
    vscode.window.showWarningMessage(`${USER_MESSAGE_PREFIX}no style guides available.`);
    return;
  }

  const currentStyleGuideId = getStyleGuideId() || cachedStyleGuides.find((g) => g.isDefault)?.id;

  const items: vscode.QuickPickItem[] = cachedStyleGuides.map((guide) => ({
    label: guide.name + (guide.isDefault ? " (default)" : ""),
    description: guide.id === currentStyleGuideId ? "✓ Selected" : (guide.language ?? ""),
    detail: guide.id,
  }));

  const selected = await vscode.window.showQuickPick(items, {
    title: "Select Style Guide",
    placeHolder: "Choose a style guide for content checking",
    canPickMany: false,
    matchOnDescription: true,
    matchOnDetail: true,
  });

  if (!selected?.detail) {
    return;
  }

  await getConfig().update("styleGuide", selected.detail, vscode.ConfigurationTarget.Global);
  vscode.window.showInformationMessage(`MarkupAI: Style guide set to "${selected.label}"`);

  const editor = vscode.window.activeTextEditor;
  if (editor) {
    void checkDocument(editor.document, true);
  }
}

async function showScoresDialog(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showInformationMessage("No active editor");
    return;
  }

  const assessment = diagnosticsManager.getAssessment(editor.document.uri.toString());
  if (!assessment) {
    vscode.window.showInformationMessage("No results available. Run a check first.");
    return;
  }

  const { risk, score } = assessment;
  const currentStyleGuideId = getStyleGuideId() || cachedStyleGuides.find((g) => g.isDefault)?.id;
  const styleGuideLabel =
    cachedStyleGuides.find((g) => g.id === currentStyleGuideId)?.name ||
    currentStyleGuideId ||
    "Default";

  const items: vscode.QuickPickItem[] = [];

  if (typeof score === "number") {
    items.push(
      { label: "Score", kind: vscode.QuickPickItemKind.Separator },
      {
        label: `${getScoreEmoji(score)} Quality Score: ${String(score)}`,
        description: `${String(risk.total)} issues`,
      },
    );
  }

  items.push(
    { label: "Risk", kind: vscode.QuickPickItemKind.Separator },
    { label: `🔴 High: ${String(risk.high)}`, description: "issues" },
    { label: `🟡 Medium: ${String(risk.medium)}`, description: "issues" },
    { label: `🔵 Low: ${String(risk.low)}`, description: "issues" },
    { label: "Settings", kind: vscode.QuickPickItemKind.Separator },
    {
      label: "$(gear) Style Guide",
      description: styleGuideLabel,
      detail: "Click to change style guide",
    },
  );

  const selected = await vscode.window.showQuickPick(items, {
    title: "MarkupAI Content Assessment",
    placeHolder: "Risk assessment for current document",
    canPickMany: false,
  });

  if (selected?.label.includes("Style Guide")) {
    await selectStyleGuide();
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

  const extensionVersion =
    (context.extension.packageJSON as { version?: string }).version ?? "0.0.0";

  // Sidebar mode: webview view hosting the MarkupAI sidebar app
  const sidebarBridge = new SidebarBridge();
  sidebarBridge.trackEditor(vscode.window.activeTextEditor);
  context.subscriptions.push(
    sidebarBridge,
    vscode.window.registerWebviewViewProvider(
      SidebarViewProvider.viewType,
      new SidebarViewProvider(context.extensionUri, extensionVersion, sidebarBridge),
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
  );

  // Initialize auth
  auth = new AuthManager(context.secrets, () => ({
    baseUrl: getApiBaseUrl(),
    provider: OAUTH_PROVIDER,
  }));
  context.subscriptions.push(auth);

  // Initialize diagnostic collection
  const diagnosticCollection = vscode.languages.createDiagnosticCollection("markupai");
  context.subscriptions.push(diagnosticCollection);

  // Initialize managers
  diagnosticsManager = new DiagnosticsManager(diagnosticCollection);

  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.name = "MarkupAI";
  context.subscriptions.push(statusBarItem);
  statusBar = new StatusBarManager(statusBarItem);

  // Set initial enabled state
  isEnabled = getConfig().get("enabled", true);
  vscode.commands.executeCommand("setContext", "markupai.enabled", isEnabled);
  vscode.commands.executeCommand("setContext", "markupai.showAllFiles", true);

  // Initialize Findings TreeView
  findingsTreeDataProvider = new FindingsTreeDataProvider(() => diagnosticsManager.getAllIssues());
  const findingsTreeView = vscode.window.createTreeView("markupai.findings", {
    treeDataProvider: findingsTreeDataProvider,
    showCollapseAll: true,
  });
  context.subscriptions.push(findingsTreeView);

  // Initialize Folder Scanner TreeView
  folderScannerTreeDataProvider = new FolderScannerTreeDataProvider(() => {
    const assessments = new Map<string, DocumentAssessment>();
    diagnosticsManager.getAllIssues().forEach((_, docKey) => {
      const a = diagnosticsManager.getAssessment(docKey);
      if (a) {
        assessments.set(docKey, a);
      }
    });
    return assessments;
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

      const severityLabels: Record<string, string> = {
        high: "🔴 High",
        medium: "🟡 Medium",
        low: "🔵 Low",
      };
      const items = severities.map((s) => ({
        label: severityLabels[s] ?? "🔵 Low",
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

      if (folderUri?.[0]) {
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
      if (!(await requireSignIn())) {
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
      if (!(await requireSignIn())) {
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

  // Register Code Actions Provider and Hover Provider for all supported schemes
  const codeActionProvider = new MarkupAICodeActionProvider();
  const hoverProvider = new MarkupAIHoverProvider((uri) =>
    diagnosticsManager.getDiagnosticsForUri(uri),
  );

  for (const scheme of SUPPORTED_SCHEMES) {
    context.subscriptions.push(
      vscode.languages.registerCodeActionsProvider({ scheme }, codeActionProvider, {
        providedCodeActionKinds: MarkupAICodeActionProvider.providedCodeActionKinds,
      }),
    );
    context.subscriptions.push(vscode.languages.registerHoverProvider({ scheme }, hoverProvider));
  }

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
    vscode.commands.registerCommand("markupai.signIn", signIn),
    vscode.commands.registerCommand("markupai.signOut", signOut),
    vscode.commands.registerCommand("markupai.switchMode", async () => {
      const next = isSidebarMode() ? "native" : "sidebar";
      await getConfig().update("mode", next, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage(`MarkupAI: switched to ${next} mode.`);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("markupai.selectStyleGuide", selectStyleGuide),
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
      sidebarBridge.handleDocumentClosed(document.uri);
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
      sidebarBridge.trackEditor(editor);
      void (async () => {
        if (isSidebarMode()) {
          statusBar.showSidebarMode();
          return;
        }
        if (editor) {
          const assessment = diagnosticsManager.getAssessment(editor.document.uri.toString());
          if (assessment) {
            statusBar.update(assessment);
          } else if (await auth.isSignedIn()) {
            void checkDocument(editor.document);
          } else {
            statusBar.showSignedOut();
          }
        } else {
          statusBar.hide();
        }
      })();
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
        if (isEnabled) {
          const editor = vscode.window.activeTextEditor;
          if (editor) {
            void checkDocument(editor.document);
          }
        } else {
          diagnosticsManager.clearAll();
          findingsTreeDataProvider.refresh();
          statusBar.showDisabled();
        }
      }

      if (event.affectsConfiguration("markupai.environment")) {
        resetSessionCaches();
        void refreshStyleGuides();
      }

      if (event.affectsConfiguration("markupai.mode")) {
        if (isSidebarMode()) {
          // Native artifacts are meaningless in sidebar mode.
          diagnosticsManager.clearAll();
          findingsTreeDataProvider.refresh();
          statusBar.showSidebarMode();
        } else {
          void (async () => {
            if (await auth.isSignedIn()) {
              void refreshStyleGuides();
              const editor = vscode.window.activeTextEditor;
              if (editor) {
                void checkDocument(editor.document);
              } else {
                statusBar.hide();
              }
            } else {
              statusBar.showSignedOut();
            }
          })();
        }
      }
    }),
  );

  // Initial setup
  void (async () => {
    if (isSidebarMode()) {
      statusBar.showSidebarMode();
      return;
    }
    if (await auth.isSignedIn()) {
      void refreshStyleGuides();
      if (vscode.window.activeTextEditor) {
        void checkDocument(vscode.window.activeTextEditor.document);
      }
    } else {
      statusBar.showSignedOut();
    }
  })();
}

// This method is called when your extension is deactivated
export function deactivate() {
  for (const timer of checkDebounceTimers.values()) {
    clearTimeout(timer);
  }
  checkDebounceTimers.clear();
}
