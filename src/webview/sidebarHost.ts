/**
 * Sidebar webview script. Runs inside the VS Code webview (DOM context),
 * mounts the hosted MarkupAI sidebar in an iframe via the adapter, and
 * implements the adapter's PluginInterface as RPC stubs that forward each
 * call to the extension host, which performs the real document operations.
 *
 *   sidebar iframe  ⇄  this script (adapter IPC)  ⇄  extension host (RPC)
 */
import {
  createSidebarHost,
  ensureSidebarHostShell,
  sidebarPostMessageTargetOrigin,
  reconstructError,
  type ContentInfo,
  type ContentRange,
  type ContentReplacement,
  type PluginInterface,
  type SidebarConfig,
} from "@markupai/sidebar-adapter";
import {
  RPC_REQUEST,
  isRpcResponse,
  RPC_ERROR,
  type RpcRequest,
  type SidebarBootstrap,
} from "./rpc";
import { themeKindToColorScheme } from "./theme";

interface VsCodeApi {
  postMessage(message: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

declare global {
  var __MARKUPAI_BOOTSTRAP__: SidebarBootstrap | undefined;
}

const vscode = acquireVsCodeApi();
const bootstrap = globalThis.__MARKUPAI_BOOTSTRAP__;

// ============================================================================
// RPC to the extension host
// ============================================================================

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

let nextRpcId = 1;
const pending = new Map<number, Pending>();

globalThis.addEventListener("message", (event: MessageEvent<unknown>) => {
  // RPC responses come from the extension host, delivered with this
  // webview's own origin. The sidebar iframe also posts messages to this
  // window (adapter IPC, handled elsewhere) — never parse those as RPC.
  if (event.origin !== globalThis.location.origin) {
    return;
  }
  const data = event.data;
  if (!isRpcResponse(data)) {
    return;
  }
  const entry = pending.get(data.id);
  if (!entry) {
    return;
  }
  pending.delete(data.id);
  if (data.type === RPC_ERROR) {
    entry.reject(reconstructError(data.error));
  } else {
    entry.resolve(data.result);
  }
});

function rpc<T>(method: string, args: unknown[] = []): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = nextRpcId++;
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
    const request: RpcRequest = { type: RPC_REQUEST, id, method, args };
    vscode.postMessage(request);
  });
}

async function rpcVoid(method: string, args: unknown[] = []): Promise<void> {
  await rpc<unknown>(method, args);
}

// ============================================================================
// PluginInterface — forwarded to the extension host
// ============================================================================

function buildPlugin(boot: SidebarBootstrap): PluginInterface {
  return {
    getInitConfig: (): Promise<SidebarConfig> =>
      Promise.resolve({
        integrationName: boot.integrationName,
        integrationId: boot.integrationId,
        integrationVersion: boot.integrationVersion,
        // Popups cannot be created from a VS Code webview; the sidebar must
        // use the backend-mediated OAuth flow with openAuthUrl below.
        auth: { type: "mediation" },
        useCheckPreviewDialog: false,
        supportCheckSelection: true,
        hideBanner: false,
      }),

    getContent: () => rpc<ContentInfo>("getContent"),
    getSelectedContent: () => rpc<ContentInfo>("getSelectedContent"),
    selectContent: (range: ContentRange) => rpcVoid("selectContent", [range]),
    replaceContent: (suggestion: string, range: ContentRange) =>
      rpcVoid("replaceContent", [suggestion, range]),
    replaceMultipleContents: (replacements: ContentReplacement[]) =>
      rpcVoid("replaceMultipleContents", [replacements]),

    // The browser hand-off for mediated sign-in: the extension host opens
    // the Auth0 authorize URL via vscode.env.openExternal.
    openAuthUrl: (url: string) => rpcVoid("openAuthUrl", [url]),

    // VS Code has no host-rendered dialog surface; the sidebar is configured
    // with useCheckPreviewDialog: false so these are never exercised.
    showDialog: () => Promise.reject(new Error("Dialogs are not supported in VS Code")),
    closeDialog: () => Promise.reject(new Error("Dialogs are not supported in VS Code")),
  };
}

// ============================================================================
// Theme sync
// ============================================================================

/**
 * Mirror VS Code's theme into the sidebar. The sidebar's default theme mode
 * is "system" (prefers-color-scheme), and Chromium derives a cross-origin
 * iframe's preferred color scheme from the embedder's `color-scheme` — so
 * setting it here flips the sidebar between light and dark with the editor,
 * observed live so it follows theme switches. An explicit light/dark choice
 * made inside the sidebar still wins, as it should.
 */
function syncVsCodeTheme(iframe: HTMLIFrameElement): void {
  const apply = () => {
    const scheme = themeKindToColorScheme(
      document.body.dataset.vscodeThemeKind ?? "",
      document.body.classList,
    );
    document.documentElement.style.colorScheme = scheme;
    iframe.style.colorScheme = scheme;
  };

  new MutationObserver(apply).observe(document.body, {
    attributes: true,
    attributeFilter: ["class", "data-vscode-theme-kind"],
  });
  apply();
}

// ============================================================================
// Mount
// ============================================================================

function mount(): void {
  if (!bootstrap) {
    document.body.textContent = "MarkupAI: failed to initialize the sidebar view.";
    return;
  }

  // Creates the container and injects the adapter's full-viewport shell
  // CSS (same shell the Figma plugin UI uses).
  const container = ensureSidebarHostShell();

  const host = createSidebarHost({
    plugin: buildPlugin(bootstrap),
    iframeMount: {
      container,
      src: bootstrap.sidebarUrl,
    },
    loadOverlayContainer: container,
    adapterOptions: {
      targetOrigin: sidebarPostMessageTargetOrigin(bootstrap.sidebarUrl),
    },
  });

  syncVsCodeTheme(host.iframe);
}

mount();
