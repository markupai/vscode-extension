import * as vscode from "vscode";
import {
  AUTH_URLS,
  SIDEBAR_INTEGRATION_ID,
  SIDEBAR_INTEGRATION_NAME,
  SIDEBAR_URLS,
} from "../constants";
import { getEnvironment } from "../utils";
import {
  RPC_ERROR,
  RPC_RESULT,
  isRpcRequest,
  type RpcRequest,
  type SidebarBootstrap,
} from "../webview/rpc";

/**
 * Handles the document-side of the sidebar's PluginInterface calls.
 * Implemented by the document bridge; every method runs in the extension
 * host against the tracked active document.
 */
export interface SidebarRpcHandler {
  handle(method: string, args: unknown[]): Promise<unknown>;
}

/**
 * Renders the MarkupAI sidebar webview: a page whose script mounts the
 * hosted sidebar app in an iframe (via @markupai/sidebar-adapter) and
 * forwards PluginInterface calls here over webview messaging.
 */
export class SidebarViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = "markupai.sidebar";

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly extensionVersion: string,
    private readonly rpcHandler: SidebarRpcHandler,
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    const webview = webviewView.webview;
    webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "out", "webview")],
    };

    webview.onDidReceiveMessage((message: unknown) => {
      if (isRpcRequest(message)) {
        void this.dispatch(webview, message);
      }
    });

    webview.html = this.buildHtml(webview);
  }

  private async dispatch(webview: vscode.Webview, request: RpcRequest): Promise<void> {
    try {
      const result = await this.rpcHandler.handle(request.method, request.args);
      await webview.postMessage({ type: RPC_RESULT, id: request.id, result });
    } catch (error) {
      const name = error instanceof Error ? error.name : "Error";
      const message = error instanceof Error ? error.message : String(error);
      await webview.postMessage({ type: RPC_ERROR, id: request.id, error: { name, message } });
    }
  }

  private buildHtml(webview: vscode.Webview): string {
    const environment = getEnvironment();
    const sidebarUrl = SIDEBAR_URLS[environment];
    const sidebarOrigin = new URL(sidebarUrl).origin;
    // Sign-out redirects the iframe to the Auth0 custom domain and back, so
    // the CSP must permit framing it as well as the sidebar origin.
    const authOrigin = new URL(AUTH_URLS[environment]).origin;
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "out", "webview", "sidebarHost.js"),
    );
    const nonce = generateNonce();

    const bootstrap: SidebarBootstrap = {
      sidebarUrl,
      integrationName: SIDEBAR_INTEGRATION_NAME,
      integrationId: SIDEBAR_INTEGRATION_ID,
      integrationVersion: this.extensionVersion,
    };

    const csp = [
      "default-src 'none'",
      `frame-src ${sidebarOrigin} ${authOrigin}`,
      `script-src 'nonce-${nonce}'`,
      // The adapter's load overlay styles elements inline.
      "style-src 'unsafe-inline'",
      `img-src ${webview.cspSource} ${sidebarOrigin}`,
    ].join("; ");

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="light dark" />
  <title>MarkupAI</title>
  <style nonce="${nonce}"></style>
</head>
<body>
  <script nonce="${nonce}">globalThis.__MARKUPAI_BOOTSTRAP__ = ${JSON.stringify(bootstrap)};</script>
  <script nonce="${nonce}" src="${scriptUri.toString()}"></script>
</body>
</html>`;
  }
}

function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
