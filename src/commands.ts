import * as vscode from "vscode";
import { USER_MESSAGE_PREFIX, SUPPORTED_EXTENSIONS } from "./constants.js";
import { promptForToken } from "./auth.js";
import type { AgentRegistry } from "./agentRegistry.js";
import type { AuthStore } from "./auth.js";
import type { DiagnosticsManager } from "./diagnostics.js";
import type { ExtensionConfig } from "./config.js";
import type { Logger } from "./logger.js";
import type { Scanner } from "./scanner.js";

export interface CommandDeps {
  auth: AuthStore;
  config: ExtensionConfig;
  registry: AgentRegistry;
  scanner: Scanner;
  diagnostics: DiagnosticsManager;
  logger: Logger;
  onAgentsRefreshed: () => void | Promise<void>;
}

export function registerCommands(
  context: vscode.ExtensionContext,
  deps: CommandDeps,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("markupai.signIn", async () => {
      const ok = await promptForToken(deps.auth);
      if (ok) {
        try {
          await deps.registry.refresh();
          await deps.onAgentsRefreshed();
        } catch (err) {
          deps.logger.error("post-signin refresh failed", err);
        }
      }
    }),

    vscode.commands.registerCommand("markupai.signOut", async () => {
      await deps.auth.clearToken();
      deps.diagnostics.clear();
      void vscode.window.showInformationMessage(`${USER_MESSAGE_PREFIX}signed out.`);
    }),

    vscode.commands.registerCommand("markupai.refreshAgents", async () => {
      try {
        const agents = await deps.registry.refresh();
        await deps.onAgentsRefreshed();
        void vscode.window.showInformationMessage(
          `${USER_MESSAGE_PREFIX}loaded ${agents.length} agent${agents.length === 1 ? "" : "s"}.`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        deps.logger.error("refresh failed", msg);
        void vscode.window.showErrorMessage(`${USER_MESSAGE_PREFIX}${msg}`);
      }
    }),

    vscode.commands.registerCommand("markupai.clearDiagnostics", () => {
      const editor = vscode.window.activeTextEditor;
      if (editor) deps.diagnostics.clear(editor.document.uri);
      else deps.diagnostics.clear();
    }),

    vscode.commands.registerCommand("markupai.scanCurrentFile", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        void vscode.window.showWarningMessage(`${USER_MESSAGE_PREFIX}no active editor.`);
        return;
      }
      await scanDocument(editor.document, deps);
    }),

    vscode.commands.registerCommand("markupai.openAgentConfig", async () => {
      await vscode.commands.executeCommand("markupai.agentConfig.focus");
    }),

    vscode.commands.registerCommand("markupai.openBatchCheck", async () => {
      await vscode.commands.executeCommand("markupai.batchCheck.focus");
    }),

    vscode.commands.registerCommand(
      "markupai._dismissIssues",
      (uriStr: string, ids: string[]) => {
        const uri = vscode.Uri.parse(uriStr);
        const existing = deps.diagnostics.getAllIssues(uri);
        const dismissed = new Set(ids);
        const perAgent = new Map<string, typeof existing>();
        for (const issue of existing) {
          if (dismissed.has(issue.id)) continue;
          const slug = issue.agent;
          perAgent.set(slug, [...(perAgent.get(slug) ?? []), issue]);
        }
        deps.diagnostics.clear(uri);
        for (const [slug, list] of perAgent) {
          deps.diagnostics.setIssuesForAgent(uri, slug, list);
        }
      },
    ),
  );
}

export async function scanDocument(
  doc: vscode.TextDocument,
  deps: CommandDeps,
): Promise<void> {
  const fileName = doc.fileName;
  const lower = fileName.toLowerCase();
  const supported = SUPPORTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
  if (!supported) {
    void vscode.window.showWarningMessage(
      `${USER_MESSAGE_PREFIX}file type not supported: ${fileName}`,
    );
    return;
  }

  if (!(await deps.auth.hasToken())) {
    const pick = await vscode.window.showWarningMessage(
      `${USER_MESSAGE_PREFIX}not signed in.`,
      "Sign in",
    );
    if (pick === "Sign in") {
      await vscode.commands.executeCommand("markupai.signIn");
    }
    return;
  }

  if (deps.registry.getAll().length === 0) {
    try {
      await deps.registry.refresh();
      await deps.onAgentsRefreshed();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      void vscode.window.showErrorMessage(`${USER_MESSAGE_PREFIX}${msg}`);
      return;
    }
  }

  const agentSlugs = deps.config.getEnabledAgents();
  if (!agentSlugs.length) {
    void vscode.window.showWarningMessage(
      `${USER_MESSAGE_PREFIX}no agents enabled. Open "MarkupAI: Open Agent Configuration".`,
    );
    return;
  }

  const agentConfig = {
    target_id: deps.config.getStyleGuideTargetId() || undefined,
  };

  deps.diagnostics.clear(doc.uri);

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `${USER_MESSAGE_PREFIX}scanning ${doc.fileName}`,
      cancellable: true,
    },
    async (progress, token) => {
      const controller = new AbortController();
      token.onCancellationRequested(() => controller.abort());
      try {
        const result = await deps.scanner.scan({
          uri: doc.uri,
          text: doc.getText(),
          fileName: doc.fileName,
          agentSlugs,
          agentConfig,
          signal: controller.signal,
          onProgress: (info) => {
            progress.report({
              message: `${info.agentSlug}: +${info.issues.length} issue${info.issues.length === 1 ? "" : "s"}`,
            });
          },
        });
        const msg = result.errors.length
          ? `${USER_MESSAGE_PREFIX}scan finished with errors: ${result.errors.join("; ")}`
          : `${USER_MESSAGE_PREFIX}scan complete — ${result.totalIssues} issue${result.totalIssues === 1 ? "" : "s"}.`;
        if (result.errors.length) void vscode.window.showWarningMessage(msg);
        else void vscode.window.showInformationMessage(msg);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        deps.logger.error("scan failed", message);
        void vscode.window.showErrorMessage(`${USER_MESSAGE_PREFIX}${message}`);
      }
    },
  );
}
