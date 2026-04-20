import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import { _resetVscodeMock } from "../mocks/vscode.js";
import { BatchCheckView } from "../../src/views/batchCheckView.js";
import { ExtensionConfig } from "../../src/config.js";
import type { Logger } from "../../src/logger.js";
import type { Scanner } from "../../src/scanner.js";

function makeLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;
}

function fakeView(): {
  view: vscode.WebviewView;
  setHtml: ReturnType<typeof vi.fn>;
  post: (m: unknown) => Promise<void>;
} {
  let handler: ((m: unknown) => void) | undefined;
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
    onDidChangeVisibility: () => ({
      dispose() {
        /* noop */
      },
    }),
  } as unknown as vscode.WebviewView;
  return {
    view,
    setHtml,
    post: async (m: unknown) => {
      if (!handler) throw new Error("no handler");
      await handler(m);
    },
  };
}

describe("BatchCheckView", () => {
  beforeEach(() => _resetVscodeMock());

  it("renders a 'no files' message when workspace has nothing supported", async () => {
    const f = fakeView();
    const scanner = { scan: vi.fn() } as unknown as Scanner;
    const view = new BatchCheckView(new ExtensionConfig(), scanner, makeLogger());
    view.resolveWebviewView(f.view);
    await new Promise((r) => setTimeout(r, 0));
    const html = (f.setHtml.mock.calls.at(-1)?.[0] ?? "") as string;
    expect(html).toContain("Batch Check");
  });

  it("runs scanner for each selected file and updates status", async () => {
    const uri = vscode.Uri.file("/tmp/a.md");
    (vscode.workspace as any).workspaceFolders = [
      { uri: vscode.Uri.file("/tmp"), name: "tmp", index: 0 },
    ];
    vi.spyOn(vscode.workspace, "findFiles").mockResolvedValue([uri]);
    vi.spyOn(vscode.workspace.fs, "readFile").mockResolvedValue(new TextEncoder().encode("hi"));

    const scanner = {
      scan: vi.fn(async () => ({ totalIssues: 2, perAgent: {}, errors: [] })),
    } as unknown as Scanner;

    const f = fakeView();
    const view = new BatchCheckView(new ExtensionConfig(), scanner, makeLogger());
    view.resolveWebviewView(f.view);
    await new Promise((r) => setTimeout(r, 0));
    await f.post({ type: "run", uris: [uri.toString()] });
    expect(scanner.scan).toHaveBeenCalled();
    const html = (f.setHtml.mock.calls.at(-1)?.[0] ?? "") as string;
    expect(html).toContain("2 issues");
  });

  it("captures scan errors per file", async () => {
    const uri = vscode.Uri.file("/tmp/a.md");
    (vscode.workspace as any).workspaceFolders = [
      { uri: vscode.Uri.file("/tmp"), name: "tmp", index: 0 },
    ];
    vi.spyOn(vscode.workspace, "findFiles").mockResolvedValue([uri]);
    vi.spyOn(vscode.workspace.fs, "readFile").mockResolvedValue(new TextEncoder().encode("hi"));

    const scanner = {
      scan: vi.fn(async () => ({ totalIssues: 0, perAgent: {}, errors: ["bad"] })),
    } as unknown as Scanner;
    const f = fakeView();
    const view = new BatchCheckView(new ExtensionConfig(), scanner, makeLogger());
    view.resolveWebviewView(f.view);
    await new Promise((r) => setTimeout(r, 0));
    await f.post({ type: "run", uris: [uri.toString()] });
    const html = (f.setHtml.mock.calls.at(-1)?.[0] ?? "") as string;
    expect(html).toContain("bad");
  });

  it("refresh message re-discovers files", async () => {
    const findSpy = vi.spyOn(vscode.workspace, "findFiles").mockResolvedValue([]);
    (vscode.workspace as any).workspaceFolders = [
      { uri: vscode.Uri.file("/tmp"), name: "tmp", index: 0 },
    ];
    const f = fakeView();
    const view = new BatchCheckView(
      new ExtensionConfig(),
      { scan: vi.fn() } as unknown as Scanner,
      makeLogger(),
    );
    view.resolveWebviewView(f.view);
    await new Promise((r) => setTimeout(r, 0));
    findSpy.mockClear();
    await f.post({ type: "refresh" });
    expect(findSpy).toHaveBeenCalled();
  });

  it("ignores unknown messages", async () => {
    const f = fakeView();
    const view = new BatchCheckView(
      new ExtensionConfig(),
      { scan: vi.fn() } as unknown as Scanner,
      makeLogger(),
    );
    view.resolveWebviewView(f.view);
    await new Promise((r) => setTimeout(r, 0));
    await expect(f.post({ type: "bogus" })).resolves.toBeUndefined();
    await expect(f.post("not an object")).resolves.toBeUndefined();
  });
});
