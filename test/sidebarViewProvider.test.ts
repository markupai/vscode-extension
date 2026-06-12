import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import * as vscode from "vscode";
import { TextLookupError } from "@markupai/sidebar-adapter";
import { SidebarViewProvider, type SidebarRpcHandler } from "../src/sidebar/sidebarViewProvider";
import { RPC_ERROR, RPC_REQUEST, RPC_RESULT } from "../src/webview/rpc";

function createWebviewView() {
  let messageListener: ((message: unknown) => void) | undefined;
  const webview = {
    options: {} as Record<string, unknown>,
    html: "",
    cspSource: "vscode-resource:",
    onDidReceiveMessage: vi.fn((listener: (message: unknown) => void) => {
      messageListener = listener;
      return { dispose: vi.fn() };
    }),
    postMessage: vi.fn(() => Promise.resolve(true)),
    asWebviewUri: vi.fn((uri: vscode.Uri) => uri),
  };
  return {
    webviewView: { webview } as unknown as vscode.WebviewView,
    webview,
    sendMessage: (message: unknown) => {
      if (!messageListener) {
        throw new Error("listener not registered");
      }
      messageListener(message);
    },
  };
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("SidebarViewProvider", () => {
  type HandleMock = Mock<(method: string, args: unknown[]) => Promise<unknown>>;
  let handler: SidebarRpcHandler & { handle: HandleMock };
  let provider: SidebarViewProvider;

  beforeEach(() => {
    handler = { handle: vi.fn<(method: string, args: unknown[]) => Promise<unknown>>() };
    provider = new SidebarViewProvider(vscode.Uri.file("/ext"), "1.2.3", handler);
  });

  it("renders HTML with bootstrap, nonce, and the sidebar origin in the CSP", () => {
    const { webviewView, webview } = createWebviewView();

    provider.resolveWebviewView(webviewView);

    expect(webview.options).toEqual(
      expect.objectContaining({ enableScripts: true }) as Record<string, unknown>,
    );
    expect(webview.html).toContain("globalThis.__MARKUPAI_BOOTSTRAP__");
    expect(webview.html).toContain("https://sidebar.markup.ai");
    expect(webview.html).toContain("frame-src https://sidebar.markup.ai");
    expect(webview.html).toContain('"integrationId":"vscode-extension"');
    expect(webview.html).toContain('"integrationVersion":"1.2.3"');
    const nonces = webview.html.match(/nonce="([a-f0-9]{32})"/g);
    expect(nonces?.length).toBeGreaterThanOrEqual(2);
  });

  it("dispatches RPC requests to the handler and posts the result", async () => {
    const { webviewView, webview, sendMessage } = createWebviewView();
    provider.resolveWebviewView(webviewView);
    handler.handle.mockResolvedValue({ content: "text" });

    sendMessage({ type: RPC_REQUEST, id: 7, method: "getContent", args: [] });
    await flush();

    expect(handler.handle).toHaveBeenCalledWith("getContent", []);
    expect(webview.postMessage).toHaveBeenCalledWith({
      type: RPC_RESULT,
      id: 7,
      result: { content: "text" },
    });
  });

  it("serializes handler errors with their name preserved", async () => {
    const { webviewView, webview, sendMessage } = createWebviewView();
    provider.resolveWebviewView(webviewView);
    handler.handle.mockRejectedValue(new TextLookupError("gone"));

    sendMessage({ type: RPC_REQUEST, id: 8, method: "selectContent", args: [{}] });
    await flush();

    expect(webview.postMessage).toHaveBeenCalledWith({
      type: RPC_ERROR,
      id: 8,
      error: { name: "TextLookupError", message: "gone" },
    });
  });

  it("serializes non-Error throws as plain errors", async () => {
    const { webviewView, webview, sendMessage } = createWebviewView();
    provider.resolveWebviewView(webviewView);
    handler.handle.mockRejectedValue("string failure");

    sendMessage({ type: RPC_REQUEST, id: 9, method: "getContent", args: [] });
    await flush();

    expect(webview.postMessage).toHaveBeenCalledWith({
      type: RPC_ERROR,
      id: 9,
      error: { name: "Error", message: "string failure" },
    });
  });

  it("ignores non-RPC messages", async () => {
    const { webviewView, webview, sendMessage } = createWebviewView();
    provider.resolveWebviewView(webviewView);

    sendMessage({ type: "something-else" });
    sendMessage(null);
    await flush();

    expect(handler.handle).not.toHaveBeenCalled();
    expect(webview.postMessage).not.toHaveBeenCalled();
  });
});
