import * as vscode from "vscode";
import { AgentRegistry } from "./agentRegistry.js";
import { AuthStore } from "./auth.js";
import { MarkupAIClient } from "./apiClient.js";
import { DiagnosticsManager } from "./diagnostics.js";
import { ExtensionConfig } from "./config.js";
import { Logger } from "./logger.js";
import { MarkupAICodeActionProvider } from "./codeActionProvider.js";
import { MarkupAIHoverProvider } from "./hoverProvider.js";
import { Scanner } from "./scanner.js";
import { AgentConfigView } from "./views/agentConfigView.js";
import { BatchCheckView } from "./views/batchCheckView.js";
import { registerCommands } from "./commands.js";
import { SUPPORTED_EXTENSIONS } from "./constants.js";

/**
 * Thin activation orchestrator — instantiates collaborators and wires
 * them together. All non-UI logic lives in dedicated modules so this
 * file stays small and can be excluded from coverage.
 */
export function activate(context: vscode.ExtensionContext): void {
  const logger = new Logger();
  const config = new ExtensionConfig();
  logger.setLevel(config.getLogLevel());

  const auth = new AuthStore(context.secrets);
  const extVersion = (context.extension.packageJSON as { version?: string }).version ?? "0.0.0";
  const client = new MarkupAIClient(config, auth, logger, extVersion);
  const registry = new AgentRegistry(client);
  const diagnostics = new DiagnosticsManager();
  const scanner = new Scanner(client, registry, diagnostics, logger);

  const agentConfigView = new AgentConfigView(config, auth, registry, client, logger);
  const batchCheckView = new BatchCheckView(config, scanner, logger);

  context.subscriptions.push(
    logger,
    auth,
    diagnostics,
    vscode.window.registerWebviewViewProvider(AgentConfigView.viewId, agentConfigView),
    vscode.window.registerWebviewViewProvider(BatchCheckView.viewId, batchCheckView),
    vscode.languages.registerHoverProvider(docSelectors(), new MarkupAIHoverProvider(diagnostics)),
    vscode.languages.registerCodeActionsProvider(
      docSelectors(),
      new MarkupAICodeActionProvider(diagnostics),
      { providedCodeActionKinds: MarkupAICodeActionProvider.providedCodeActionKinds },
    ),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("markupai.logLevel")) logger.setLevel(config.getLogLevel());
    }),
  );

  registerCommands(context, {
    auth,
    config,
    registry,
    scanner,
    diagnostics,
    logger,
    onAgentsRefreshed: () => agentConfigView.refresh(),
  });

  void auth.hasToken().then((ok) => {
    if (!ok) {
      logger.info("activation: no token stored, user must sign in");
      return;
    }
    registry
      .refresh()
      .then(async () => {
        await agentConfigView.refresh();
      })
      .catch((err: unknown) => {
        logger.error("initial agent refresh failed", err);
      });
  });

  logger.info(`MarkupAI activated (env=${config.getEnvironment()}, v${extVersion})`);
}

export function deactivate(): void {
  // VS Code calls dispose on subscriptions automatically.
}

function docSelectors(): vscode.DocumentSelector {
  return SUPPORTED_EXTENSIONS.map((ext) => ({ scheme: "file", pattern: `**/*${ext}` }));
}
