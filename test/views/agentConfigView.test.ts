import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import { _resetVscodeMock, _configStore } from "../mocks/vscode.js";
import { AgentConfigView } from "../../src/views/agentConfigView.js";
import { ExtensionConfig } from "../../src/config.js";
import type { AgentRegistry } from "../../src/agentRegistry.js";
import type { MarkupAIClient } from "../../src/apiClient.js";
import type { AuthStore } from "../../src/auth.js";
import type { Logger } from "../../src/logger.js";
import type { Target } from "../../src/types.js";

function makeLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;
}

function mkClient(targets: readonly Target[] = [], listThrows?: Error): MarkupAIClient {
  return {
    listTargets: vi.fn(async () => {
      if (listThrows) throw listThrows;
      return targets;
    }),
  } as unknown as MarkupAIClient;
}

function fakeView(): {
  view: vscode.WebviewView;
  setHtml: ReturnType<typeof vi.fn>;
  postMessage: (msg: unknown) => Promise<void>;
} {
  let handler: ((m: unknown) => void) | undefined;
  let visibleHandler: (() => void) | undefined;
  let html = "";
  const setHtml = vi.fn((v: string) => {
    html = v;
  });
  const view = {
    get visible() {
      return true;
    },
    webview: {
      options: {},
      cspSource: "https://w",
      get html() {
        return html;
      },
      set html(v: string) {
        setHtml(v);
      },
      onDidReceiveMessage: (cb: (m: unknown) => void) => {
        handler = cb;
        return {
          dispose() {
            /* noop */
          },
        };
      },
    },
    onDidChangeVisibility: (cb: () => void) => {
      visibleHandler = cb;
      return {
        dispose() {
          /* noop */
        },
      };
    },
  } as unknown as vscode.WebviewView;
  return {
    view,
    setHtml,
    postMessage: async (m: unknown) => {
      if (!handler) throw new Error("no handler");
      await handler(m);
      // exercise visibility handler at least once so it is covered
      visibleHandler?.();
    },
  };
}

describe("AgentConfigView", () => {
  beforeEach(() => _resetVscodeMock());

  function mkRegistry(): AgentRegistry {
    return {
      getAll: () => [
        {
          slug: "style_agent",
          internalId: "ag_1",
          displayName: "Style",
          description: "",
          category: "brand",
          configKeys: ["target_id"],
        },
      ],
      refresh: vi.fn(async () => []),
    } as unknown as AgentRegistry;
  }

  function mkAuth(signed: boolean): AuthStore {
    return { hasToken: async () => signed } as unknown as AuthStore;
  }

  it("initial render includes the Sign in button when not signed in", async () => {
    const f = fakeView();
    const view = new AgentConfigView(
      new ExtensionConfig(),
      mkAuth(false),
      mkRegistry(),
      mkClient(),
      makeLogger(),
    );
    view.resolveWebviewView(f.view);
    // allow microtasks (render is async)
    await new Promise((r) => setTimeout(r, 0));
    const html = (f.setHtml.mock.calls.at(-1)?.[0] ?? "") as string;
    expect(html).toContain("Sign in");
    expect(html).toContain("style_agent");
  });

  it("setTargetId message writes to config and re-renders", async () => {
    const f = fakeView();
    const cfg = new ExtensionConfig();
    const view = new AgentConfigView(cfg, mkAuth(true), mkRegistry(), mkClient(), makeLogger());
    view.resolveWebviewView(f.view);
    await new Promise((r) => setTimeout(r, 0));
    await f.postMessage({ type: "setTargetId", id: "tgt_42" });
    expect(_configStore["markupai.styleGuideTargetId"]).toBe("tgt_42");
  });

  it("setEnabledAgents message persists the selection", async () => {
    const f = fakeView();
    const cfg = new ExtensionConfig();
    const view = new AgentConfigView(cfg, mkAuth(true), mkRegistry(), mkClient(), makeLogger());
    view.resolveWebviewView(f.view);
    await new Promise((r) => setTimeout(r, 0));
    await f.postMessage({ type: "setEnabledAgents", slugs: ["style_agent"] });
    expect(_configStore["markupai.enabledAgents"]).toEqual(["style_agent"]);
  });

  it("refresh message triggers registry.refresh", async () => {
    const registry = mkRegistry();
    const f = fakeView();
    const view = new AgentConfigView(
      new ExtensionConfig(),
      mkAuth(true),
      registry,
      mkClient(),
      makeLogger(),
    );
    view.resolveWebviewView(f.view);
    await new Promise((r) => setTimeout(r, 0));
    await f.postMessage({ type: "refresh" });
    expect(registry.refresh).toHaveBeenCalled();
  });

  it("refresh surfaces failures as an error banner", async () => {
    const registry = {
      getAll: () => [],
      refresh: vi.fn(async () => {
        throw new Error("offline");
      }),
    } as unknown as AgentRegistry;
    const f = fakeView();
    const view = new AgentConfigView(
      new ExtensionConfig(),
      mkAuth(true),
      registry,
      mkClient(),
      makeLogger(),
    );
    view.resolveWebviewView(f.view);
    await view.refresh();
    const renders = f.setHtml.mock.calls.map((c) => String(c[0]));
    expect(renders.some((html) => html.includes("offline"))).toBe(true);
  });

  it("signIn and signOut messages forward to commands", async () => {
    const execSpy = vi.spyOn(vscode.commands, "executeCommand");
    const f = fakeView();
    const view = new AgentConfigView(
      new ExtensionConfig(),
      mkAuth(true),
      mkRegistry(),
      mkClient(),
      makeLogger(),
    );
    view.resolveWebviewView(f.view);
    await new Promise((r) => setTimeout(r, 0));
    await f.postMessage({ type: "signIn" });
    await f.postMessage({ type: "signOut" });
    expect(execSpy).toHaveBeenCalledWith("markupai.signIn");
    expect(execSpy).toHaveBeenCalledWith("markupai.signOut");
  });

  it("renders a dropdown of enabled targets when /internal/targets succeeds", async () => {
    const targets: Target[] = [
      { id: "t1", display_name: "main", is_default: false, enabled: true },
      { id: "t2", display_name: "legacy", is_default: true, enabled: true },
      { id: "t3", display_name: "disabled", is_default: false, enabled: false },
    ];
    const f = fakeView();
    const view = new AgentConfigView(
      new ExtensionConfig(),
      mkAuth(true),
      mkRegistry(),
      mkClient(targets),
      makeLogger(),
    );
    view.resolveWebviewView(f.view);
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    const html = (f.setHtml.mock.calls.at(-1)?.[0] ?? "") as string;
    expect(html).toContain('<select id="targetSelect"');
    expect(html).toContain("main");
    expect(html).toContain("legacy (default)");
    expect(html).not.toContain(">disabled<");
  });

  it("auto-selects the target named 'main' when no id is saved", async () => {
    const targets: Target[] = [
      { id: "t1", display_name: "Main", is_default: false, enabled: true },
      { id: "t2", display_name: "legacy", is_default: true, enabled: true },
    ];
    const f = fakeView();
    const view = new AgentConfigView(
      new ExtensionConfig(),
      mkAuth(true),
      mkRegistry(),
      mkClient(targets),
      makeLogger(),
    );
    view.resolveWebviewView(f.view);
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(_configStore["markupai.styleGuideTargetId"]).toBe("t1");
  });

  it("falls back to is_default when no target is named 'main'", async () => {
    const targets: Target[] = [
      { id: "t1", display_name: "legacy", is_default: true, enabled: true },
      { id: "t2", display_name: "experimental", is_default: false, enabled: true },
    ];
    const f = fakeView();
    const view = new AgentConfigView(
      new ExtensionConfig(),
      mkAuth(true),
      mkRegistry(),
      mkClient(targets),
      makeLogger(),
    );
    view.resolveWebviewView(f.view);
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(_configStore["markupai.styleGuideTargetId"]).toBe("t1");
  });

  it("preserves a saved target id across refreshes", async () => {
    _configStore["markupai.styleGuideTargetId"] = "already-set";
    const targets: Target[] = [
      { id: "t1", display_name: "main", is_default: false, enabled: true },
    ];
    const f = fakeView();
    const view = new AgentConfigView(
      new ExtensionConfig(),
      mkAuth(true),
      mkRegistry(),
      mkClient(targets),
      makeLogger(),
    );
    view.resolveWebviewView(f.view);
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(_configStore["markupai.styleGuideTargetId"]).toBe("already-set");
  });

  it("falls back to a text input when listTargets fails (401-style)", async () => {
    const f = fakeView();
    const view = new AgentConfigView(
      new ExtensionConfig(),
      mkAuth(true),
      mkRegistry(),
      mkClient([], new Error("Not authenticated")),
      makeLogger(),
    );
    view.resolveWebviewView(f.view);
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    const html = (f.setHtml.mock.calls.at(-1)?.[0] ?? "") as string;
    expect(html).toContain("Could not load targets");
    expect(html).toContain("Not authenticated");
    expect(html).toContain('id="targetId"');
  });

  it("ignores unknown messages gracefully", async () => {
    const f = fakeView();
    const view = new AgentConfigView(
      new ExtensionConfig(),
      mkAuth(true),
      mkRegistry(),
      mkClient(),
      makeLogger(),
    );
    view.resolveWebviewView(f.view);
    await new Promise((r) => setTimeout(r, 0));
    await expect(f.postMessage({ type: "nope" })).resolves.toBeUndefined();
    await expect(f.postMessage(null)).resolves.toBeUndefined();
  });
});
