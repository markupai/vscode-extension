import * as vscode from "vscode";
import { SUPPORTED_EXTENSIONS } from "../constants.js";
import type { ExtensionConfig } from "../config.js";
import type { Logger } from "../logger.js";
import type { Scanner } from "../scanner.js";
import { escapeHtml, webviewScaffold } from "./webviewShared.js";

type FileStatus = "pending" | "running" | "done" | "error";

interface FileEntry {
  uri: string;
  relPath: string;
  status: FileStatus;
  issues: number;
  error?: string;
}

/**
 * Sidebar webview that lists supported files in the workspace and runs
 * a batch scan across any subset the user selects.
 */
export class BatchCheckView implements vscode.WebviewViewProvider {
  static readonly viewId = "markupai.batchCheck";
  private view?: vscode.WebviewView;
  private files: FileEntry[] = [];
  private running = false;

  constructor(
    private readonly config: ExtensionConfig,
    private readonly scanner: Scanner,
    private readonly logger: Logger,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.onDidReceiveMessage((m) => this.handleMessage(m));
    view.onDidChangeVisibility(() => {
      if (view.visible) void this.discover();
    });
    void this.discover();
  }

  private async discover(): Promise<void> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (!folders.length) {
      this.files = [];
      this.render();
      return;
    }
    const patterns = SUPPORTED_EXTENSIONS.map((ext) => `**/*${ext}`).join(",");
    const found = await vscode.workspace.findFiles(`{${patterns}}`, "**/node_modules/**", 500);
    this.files = found.map((uri) => {
      const rel = vscode.workspace.asRelativePath(uri, false);
      return { uri: uri.toString(), relPath: rel, status: "pending" as const, issues: 0 };
    });
    this.render();
  }

  private async handleMessage(msg: unknown): Promise<void> {
    if (!isRecord(msg)) return;
    const type = typeof msg.type === "string" ? msg.type : "";
    switch (type) {
      case "refresh":
        await this.discover();
        return;
      case "run": {
        const raw: unknown = msg.uris;
        const selected = Array.isArray(raw)
          ? raw.filter((s): s is string => typeof s === "string")
          : [];
        await this.runBatch(selected);
        return;
      }
      default:
        return;
    }
  }

  private async runBatch(selectedUris: readonly string[]): Promise<void> {
    if (this.running) return;
    this.running = true;
    const agentSlugs = this.config.getEnabledAgents();
    const agentConfig = {
      target_id: this.config.getStyleGuideTargetId() || undefined,
    };
    try {
      for (const uriStr of selectedUris) {
        const entry = this.files.find((f) => f.uri === uriStr);
        if (!entry) continue;
        entry.status = "running";
        entry.issues = 0;
        delete entry.error;
        this.render();
        const uri = vscode.Uri.parse(uriStr);
        try {
          const bytes = await vscode.workspace.fs.readFile(uri);
          const text = new TextDecoder("utf-8").decode(bytes);
          const result = await this.scanner.scan({
            uri,
            text,
            fileName: entry.relPath,
            agentSlugs,
            agentConfig,
          });
          entry.issues = result.totalIssues;
          entry.status = result.errors.length ? "error" : "done";
          if (result.errors.length) entry.error = result.errors.join("; ");
        } catch (err) {
          entry.status = "error";
          entry.error = err instanceof Error ? err.message : String(err);
          this.logger.error("batch scan failed for", entry.relPath, err);
        }
        this.render();
      }
    } finally {
      this.running = false;
      this.render();
    }
  }

  private render(): void {
    if (!this.view) return;
    const body = /* html */ `
      <h2>Batch Check</h2>
      <div class="muted">Found ${this.files.length} supported file${this.files.length === 1 ? "" : "s"} in workspace.</div>
      <div class="row">
        <button data-action="run" ${this.running || this.files.length === 0 ? "disabled" : ""}>Run on selected</button>
        <button class="secondary" data-action="selectAll">Select all</button>
        <button class="secondary" data-action="refresh">Refresh</button>
      </div>
      <ul class="file-list" id="files">
        ${this.files
          .map(
            (f) => /* html */ `
          <li>
            <label>
              <input type="checkbox" data-uri="${escapeHtml(f.uri)}" />
              <span>${escapeHtml(f.relPath)}</span>
            </label>
            <span class="${statusClass(f.status)}">
              ${renderStatus(f)}
            </span>
          </li>`,
          )
          .join("")}
      </ul>
    `;
    const script = /* js */ `
      const vscode = acquireVsCodeApi();
      function post(type, extra) { vscode.postMessage({ type, ...(extra || {}) }); }
      function selected() {
        return Array.from(document.querySelectorAll('input[type="checkbox"][data-uri]:checked'))
          .map(cb => cb.getAttribute('data-uri'));
      }
      document.querySelectorAll('button[data-action]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const a = btn.getAttribute('data-action');
          if (a === 'selectAll') {
            document.querySelectorAll('input[type="checkbox"][data-uri]').forEach(cb => cb.checked = true);
          } else if (a === 'run') {
            post('run', { uris: selected() });
          } else {
            post(a);
          }
        });
      });
    `;
    this.view.webview.html = webviewScaffold(
      this.view.webview,
      "MarkupAI Batch Check",
      body,
      script,
    );
  }
}

function statusClass(s: FileStatus): string {
  switch (s) {
    case "running":
      return "status-running";
    case "done":
      return "status-ok";
    case "error":
      return "status-err";
    default:
      return "muted";
  }
}

function renderStatus(f: FileEntry): string {
  switch (f.status) {
    case "running":
      return "running…";
    case "done":
      return `${f.issues} issue${f.issues === 1 ? "" : "s"}`;
    case "error":
      return escapeHtml(f.error ?? "error");
    default:
      return "";
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}
