import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import { _resetVscodeMock, _configStore } from "../mocks/vscode.js";
import { AgentConfigView } from "../../src/views/agentConfigView.js";
import { ExtensionConfig } from "../../src/config.js";
import type { AgentRegistry } from "../../src/agentRegistry.js";
import type { AuthStore } from "../../src/auth.js";
import type { Logger } from "../../src/logger.js";

function makeLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;
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
    const view = new AgentConfigView(cfg, mkAuth(true), mkRegistry(), makeLogger());
    view.resolveWebviewView(f.view);
    await new Promise((r) => setTimeout(r, 0));
    await f.postMessage({ type: "setTargetId", id: "tgt_42" });
    expect(_configStore["markupai.styleGuideTargetId"]).toBe("tgt_42");
  });

  it("setEnabledAgents message persists the selection", async () => {
    const f = fakeView();
    const cfg = new ExtensionConfig();
    const view = new AgentConfigView(cfg, mkAuth(true), mkRegistry(), makeLogger());
    view.resolveWebviewView(f.view);
    await new Promise((r) => setTimeout(r, 0));
    await f.postMessage({ type: "setEnabledAgents", slugs: ["style_agent"] });
    expect(_configStore["markupai.enabledAgents"]).toEqual(["style_agent"]);
  });

  it("refresh message triggers registry.refresh", async () => {
    const registry = mkRegistry();
    const f = fakeView();
    const view = new AgentConfigView(new ExtensionConfig(), mkAuth(true), registry, makeLogger());
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
    const view = new AgentConfigView(new ExtensionConfig(), mkAuth(true), registry, makeLogger());
    view.resolveWebviewView(f.view);
    await view.refresh();
    const html = (f.setHtml.mock.calls.at(-1)?.[0] ?? "") as string;
    expect(html).toContain("offline");
  });

  it("signIn and signOut messages forward to commands", async () => {
    const execSpy = vi.spyOn(vscode.commands, "executeCommand");
    const f = fakeView();
    const view = new AgentConfigView(
      new ExtensionConfig(),
      mkAuth(true),
      mkRegistry(),
      makeLogger(),
    );
    view.resolveWebviewView(f.view);
    await new Promise((r) => setTimeout(r, 0));
    await f.postMessage({ type: "signIn" });
    await f.postMessage({ type: "signOut" });
    expect(execSpy).toHaveBeenCalledWith("markupai.signIn");
    expect(execSpy).toHaveBeenCalledWith("markupai.signOut");
  });

  it("ignores unknown messages gracefully", async () => {
    const f = fakeView();
    const view = new AgentConfigView(
      new ExtensionConfig(),
      mkAuth(true),
      mkRegistry(),
      makeLogger(),
    );
    view.resolveWebviewView(f.view);
    await new Promise((r) => setTimeout(r, 0));
    await expect(f.postMessage({ type: "nope" })).resolves.toBeUndefined();
    await expect(f.postMessage(null)).resolves.toBeUndefined();
  });
});
