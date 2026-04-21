import * as vscode from "vscode";
import type { AgentRegistry } from "../agentRegistry.js";
import type { AuthStore } from "../auth.js";
import type { MarkupAIClient } from "../apiClient.js";
import type { ExtensionConfig } from "../config.js";
import type { Logger } from "../logger.js";
import type { Target } from "../types.js";
import { escapeHtml, webviewScaffold } from "./webviewShared.js";

interface AgentConfigState {
  readonly signedIn: boolean;
  readonly environment: "dev" | "prod";
  readonly agents: { slug: string; displayName: string; category: string; enabled: boolean }[];
  readonly targets: readonly Target[];
  readonly targetsError?: string;
  readonly styleGuideTargetId: string;
  readonly error?: string;
}

/**
 * Sidebar webview for:
 *   - viewing sign-in status and current API environment
 *   - toggling which enabled-at-compile-time agents are active
 *   - selecting the Style agent's target from the live target list
 *
 * If `/internal/targets` isn't reachable (some PAT scopes can't see it),
 * the UI falls back to a free-text input so the user can still paste
 * a target id by hand.
 */
export class AgentConfigView implements vscode.WebviewViewProvider {
  static readonly viewId = "markupai.agentConfig";
  private view?: vscode.WebviewView;
  private targets: readonly Target[] = [];
  private targetsError?: string;

  constructor(
    private readonly config: ExtensionConfig,
    private readonly auth: AuthStore,
    private readonly registry: AgentRegistry,
    private readonly client: MarkupAIClient,
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
    void this.fetchTargets();
  }

  async refresh(): Promise<void> {
    try {
      await this.registry.refresh();
    } catch (err) {
      this.logger.error("agent refresh failed", err);
      await this.render(err instanceof Error ? err.message : String(err));
      return;
    }
    await this.fetchTargets();
    await this.render();
  }

  /**
   * Fetch the current user's targets and seed the default selection
   * when one hasn't been chosen yet:
   *   1. a target named "main" wins (case-insensitive)
   *   2. else the server-marked `is_default` target
   */
  private async fetchTargets(): Promise<void> {
    if (!(await this.auth.hasToken())) {
      this.targets = [];
      delete this.targetsError;
      return;
    }
    try {
      const all = await this.client.listTargets();
      this.targets = all.filter((t) => t.enabled);
      delete this.targetsError;
      if (!this.config.getStyleGuideTargetId().trim()) {
        const main = this.targets.find((t) => t.display_name.toLowerCase() === "main");
        const fallback = this.targets.find((t) => t.is_default);
        const picked = main ?? fallback;
        if (picked) await this.config.setStyleGuideTargetId(picked.id);
      }
    } catch (err) {
      this.targets = [];
      this.targetsError = err instanceof Error ? err.message : String(err);
      this.logger.warn("listTargets failed — falling back to text input:", this.targetsError);
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
      targets: this.targets,
      ...(this.targetsError ? { targetsError: this.targetsError } : {}),
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
        await this.fetchTargets();
        await this.render();
        return;
      case "signOut":
        await vscode.commands.executeCommand("markupai.signOut");
        this.targets = [];
        delete this.targetsError;
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
      ${renderTargetPicker(state)}
      <div class="row">
        <button data-action="saveTarget">Save target</button>
      </div>
    `;

    const script = /* js */ `
      const vscode = acquireVsCodeApi();
      function post(type, extra) { vscode.postMessage({ type, ...(extra || {}) }); }

      function currentTargetValue() {
        const select = document.getElementById('targetSelect');
        if (select) return select.value.trim();
        const input = document.getElementById('targetId');
        return input ? input.value.trim() : '';
      }

      document.querySelectorAll('button[data-action]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const action = btn.getAttribute('data-action');
          if (action === 'saveTarget') {
            post('setTargetId', { id: currentTargetValue() });
          } else {
            post(action);
          }
        });
      });

      const select = document.getElementById('targetSelect');
      if (select) {
        select.addEventListener('change', () => post('setTargetId', { id: select.value }));
      }

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

function renderTargetPicker(state: AgentConfigState): string {
  if (state.targets.length > 0) {
    const selected = state.styleGuideTargetId;
    const options = [`<option value="">— none —</option>`];
    for (const t of state.targets) {
      const sel = t.id === selected ? "selected" : "";
      const label = t.is_default ? `${t.display_name} (default)` : t.display_name;
      options.push(`<option value="${escapeHtml(t.id)}" ${sel}>${escapeHtml(label)}</option>`);
    }
    return `<select id="targetSelect">${options.join("")}</select>`;
  }
  const placeholder = "Style-guide target id (e.g. tgt_...)";
  const note = fallbackNote(state);
  return `${note}<input type="text" id="targetId" placeholder="${placeholder}" value="${escapeHtml(state.styleGuideTargetId)}" />`;
}

function fallbackNote(state: AgentConfigState): string {
  if (state.targetsError) {
    return `<div class="muted">Could not load targets (${escapeHtml(state.targetsError)}). Enter one manually.</div>`;
  }
  if (state.signedIn) {
    return `<div class="muted">No targets available. Enter one manually if you have the id.</div>`;
  }
  return `<div class="muted">Sign in to load available targets.</div>`;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}
