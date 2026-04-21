import type * as vscode from "vscode";

/** Generate a cryptographically-strong nonce for inline `<script nonce="...">`. */
export function makeNonce(): string {
  const bytes = new Uint8Array(16);
  // globalThis.crypto is available in Node 20+ and all browser contexts.
  globalThis.crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

export function defaultCsp(nonce: string, cspSource: string): string {
  return [
    `default-src 'none'`,
    `img-src ${cspSource} data:`,
    `style-src ${cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
    `font-src ${cspSource}`,
  ].join("; ");
}

export function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function sharedStyles(): string {
  return /* css */ `
    :root { color-scheme: light dark; }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
      padding: 0.75rem;
      margin: 0;
    }
    h2 { font-size: 1rem; margin: 0.75rem 0 0.25rem; }
    h3 { font-size: 0.9rem; margin: 0.75rem 0 0.25rem; color: var(--vscode-descriptionForeground); }
    small, .muted { color: var(--vscode-descriptionForeground); }
    button {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      padding: 0.35rem 0.75rem;
      border-radius: 2px;
      cursor: pointer;
    }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button.secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    input[type="text"], select {
      width: 100%;
      padding: 0.3rem 0.4rem;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 2px;
      box-sizing: border-box;
    }
    label { display: flex; gap: 0.4rem; align-items: center; padding: 0.15rem 0; }
    .row { display: flex; gap: 0.4rem; align-items: center; margin: 0.5rem 0; }
    .row button { flex: 0 0 auto; }
    .pill {
      display: inline-block;
      padding: 0 0.4rem;
      border-radius: 9px;
      font-size: 0.75rem;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
    }
    ul.file-list { list-style: none; margin: 0; padding: 0; max-height: 40vh; overflow-y: auto; border: 1px solid var(--vscode-panel-border); }
    ul.file-list li { padding: 0.25rem 0.5rem; display: flex; justify-content: space-between; gap: 0.5rem; border-bottom: 1px solid var(--vscode-panel-border); }
    ul.file-list li:last-child { border-bottom: none; }
    .status-ok { color: var(--vscode-terminal-ansiGreen); }
    .status-err { color: var(--vscode-errorForeground); }
    .status-running { color: var(--vscode-terminal-ansiYellow); }
  `;
}

export interface WebviewContextRefs {
  readonly webview: vscode.Webview;
  readonly nonce: string;
}

export function webviewScaffold(
  webview: vscode.Webview,
  title: string,
  bodyHtml: string,
  scriptJs: string,
): string {
  const nonce = makeNonce();
  const csp = defaultCsp(nonce, webview.cspSource);
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <title>${escapeHtml(title)}</title>
  <style>${sharedStyles()}</style>
</head>
<body>
  ${bodyHtml}
  <script nonce="${nonce}">${scriptJs}</script>
</body>
</html>`;
}
