import * as vscode from "vscode";
import type { AgentRegistry } from "../agentRegistry.js";
import type { AuthStore } from "../auth.js";
import type { ExtensionConfig } from "../config.js";
import type { Logger } from "../logger.js";
import { escapeHtml, webviewScaffold } from "./webviewShared.js";

interface AgentConfigState {
  readonly signedIn: boolean;
  readonly environment: "dev" | "prod";
  readonly agents: { slug: string; displayName: string; category: string; enabled: boolean }[];
  readonly styleGuideTargetId: string;
  readonly error?: string;
}

/**
 * Sidebar webview for:
 *   - viewing sign-in status and current API environment
 *   - toggling which enabled-at-compile-time agents are active
 *   - setting the Style agent's target id
 *
 * UI state is kept in sync with `ExtensionConfig` and refreshed whenever
 * the user opens the view or invokes "MarkupAI: Refresh Agents".
 */
export class AgentConfigView implements vscode.WebviewViewProvider {
  static readonly viewId = "markupai.agentConfig";
  private view?: vscode.WebviewView;

  constructor(
    private readonly config: ExtensionConfig,
    private readonly auth: AuthStore,
    private readonly registry: AgentRegistry,
    private readonly logger: Logger,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.onDidReceiveMessage((m) => this.handleMessage(m));
    view.onDidChangeVisibility(() => {
      if (view.visible) void this.render();
    });
    void this.render();
  }

  async refresh(): Promise<void> {
    try {
      await this.registry.refresh();
    } catch (err) {
      this.logger.error("agent refresh failed", err);
      await this.render(err instanceof Error ? err.message : String(err));
      return;
    }
    await this.render();
  }

  private async render(error?: string): Promise<void> {
    if (!this.view) return;
    const state: AgentConfigState = {
      signedIn: await this.auth.hasToken(),
      environment: this.config.getEnvironment(),
      agents: this.registry.getAll().map((a) => ({
        slug: a.slug,
        displayName: a.displayName,
        category: a.category,
        enabled: this.config.getEnabledAgents().includes(a.slug),
      })),
      styleGuideTargetId: this.config.getStyleGuideTargetId(),
      ...(error ? { error } : {}),
    };
    this.view.webview.html = this.buildHtml(this.view.webview, state);
  }

  private async handleMessage(msg: unknown): Promise<void> {
    if (!isRecord(msg)) return;
    const type = typeof msg.type === "string" ? msg.type : "";
    switch (type) {
      case "refresh":
        await this.refresh();
        return;
      case "signIn":
        await vscode.commands.executeCommand("markupai.signIn");
        await this.render();
        return;
      case "signOut":
        await vscode.commands.executeCommand("markupai.signOut");
        await this.render();
        return;
      case "setEnabledAgents": {
        const raw: unknown = msg.slugs;
        const slugs = Array.isArray(raw)
          ? raw.filter((s): s is string => typeof s === "string")
          : [];
        await this.config.setEnabledAgents(slugs);
        await this.render();
        return;
      }
      case "setTargetId": {
        const id = typeof msg.id === "string" ? msg.id : "";
        await this.config.setStyleGuideTargetId(id);
        await this.render();
        return;
      }
      default:
        return;
    }
  }

  private buildHtml(webview: vscode.Webview, state: AgentConfigState): string {
    const body = /* html */ `
      <h2>MarkupAI</h2>
      <div class="muted">
        Environment: <span class="pill">${state.environment}</span>
        &middot; ${state.signedIn ? "Signed in" : "Not signed in"}
      </div>
      <div class="row">
        ${
          state.signedIn
            ? `<button class="secondary" data-action="signOut">Sign out</button>`
            : `<button data-action="signIn">Sign in</button>`
        }
        <button class="secondary" data-action="refresh">Refresh agents</button>
      </div>
      ${state.error ? `<div class="status-err">${escapeHtml(state.error)}</div>` : ""}

      <h3>Agents</h3>
      ${
        state.agents.length === 0
          ? `<div class="muted">No agents loaded. Sign in and click "Refresh agents".</div>`
          : `<div id="agents">
            ${state.agents
              .map(
                (a) => /* html */ `
                <label>
                  <input type="checkbox" data-slug="${escapeHtml(a.slug)}" ${a.enabled ? "checked" : ""} />
                  <span><strong>${escapeHtml(a.displayName)}</strong>
                  <span class="muted"> &middot; ${escapeHtml(a.category)}</span></span>
                </label>`,
              )
              .join("")}
          </div>`
      }

      <h3>Style Agent &middot; target</h3>
      <input type="text" id="targetId" placeholder="Style-guide target id (e.g. tgt_...)" value="${escapeHtml(state.styleGuideTargetId)}" />
      <div class="row">
        <button data-action="saveTarget">Save target</button>
      </div>
    `;

    const script = /* js */ `
      const vscode = acquireVsCodeApi();
      function post(type, extra) { vscode.postMessage({ type, ...(extra || {}) }); }

      document.querySelectorAll('button[data-action]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const action = btn.getAttribute('data-action');
          if (action === 'saveTarget') {
            const id = document.getElementById('targetId').value.trim();
            post('setTargetId', { id });
          } else {
            post(action);
          }
        });
      });

      const boxes = Array.from(document.querySelectorAll('input[type="checkbox"][data-slug]'));
      boxes.forEach((box) => {
        box.addEventListener('change', () => {
          const slugs = boxes.filter((b) => b.checked).map((b) => b.getAttribute('data-slug'));
          post('setEnabledAgents', { slugs });
        });
      });
    `;

    return webviewScaffold(webview, "MarkupAI Agents", body, script);
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}
