import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import { _configStore, _registeredCommands, _resetVscodeMock } from "./mocks/vscode.js";
import { registerCommands, scanDocument } from "../src/commands.js";
import { DiagnosticsManager } from "../src/diagnostics.js";
import type { AgentRegistry } from "../src/agentRegistry.js";
import type { AuthStore } from "../src/auth.js";
import type { ExtensionConfig } from "../src/config.js";
import type { Logger } from "../src/logger.js";
import type { Scanner } from "../src/scanner.js";
import { ENABLED_AGENT_SLUGS } from "../src/constants.js";

function makeLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;
}

function makeContext(): vscode.ExtensionContext {
  return {
    subscriptions: [] as vscode.Disposable[],
  } as unknown as vscode.ExtensionContext;
}

interface Harness {
  auth: AuthStore;
  config: ExtensionConfig;
  registry: AgentRegistry;
  scanner: Scanner;
  diagnostics: DiagnosticsManager;
  logger: Logger;
  refreshed: ReturnType<typeof vi.fn>;
}

function makeHarness(over: Partial<Harness> = {}): Harness {
  const hasToken = vi.fn(async () => true);
  const getToken = vi.fn(async () => "mat_abc");
  const clearToken = vi.fn(async () => undefined);
  const setToken = vi.fn(async () => undefined);

  const auth = {
    hasToken,
    getToken,
    clearToken,
    setToken,
  } as unknown as AuthStore;

  const registry = {
    refresh: vi.fn(async () => []),
    getAll: vi.fn(() => [{ slug: "style_agent", internalId: "ag_1" }]),
    getBySlug: vi.fn(() => ({ slug: "style_agent", internalId: "ag_1" })),
  } as unknown as AgentRegistry;

  const scanner = {
    scan: vi.fn(async () => ({ totalIssues: 0, perAgent: {}, errors: [] })),
  } as unknown as Scanner;

  return {
    auth,
    config: {} as ExtensionConfig, // populated per-test
    registry,
    scanner,
    diagnostics: new DiagnosticsManager(),
    logger: makeLogger(),
    refreshed: vi.fn(),
    ...over,
  };
}

describe("registerCommands", () => {
  beforeEach(() => _resetVscodeMock());
  afterEach(() => vi.restoreAllMocks());

  it("registers the expected commands", () => {
    const h = makeHarness();
    registerCommands(makeContext(), {
      auth: h.auth,
      config: {} as ExtensionConfig,
      registry: h.registry,
      scanner: h.scanner,
      diagnostics: h.diagnostics,
      logger: h.logger,
      onAgentsRefreshed: h.refreshed,
    });
    const names = Array.from(_registeredCommands.keys());
    expect(names).toEqual(
      expect.arrayContaining([
        "markupai.signIn",
        "markupai.signOut",
        "markupai.refreshAgents",
        "markupai.clearDiagnostics",
        "markupai.scanCurrentFile",
        "markupai.openAgentConfig",
        "markupai.openBatchCheck",
        "markupai._dismissIssues",
      ]),
    );
  });

  it("signOut clears token and diagnostics", async () => {
    const h = makeHarness();
    registerCommands(makeContext(), {
      auth: h.auth,
      config: {} as ExtensionConfig,
      registry: h.registry,
      scanner: h.scanner,
      diagnostics: h.diagnostics,
      logger: h.logger,
      onAgentsRefreshed: h.refreshed,
    });
    const clearSpy = vi.spyOn(h.diagnostics, "clear");
    await _registeredCommands.get("markupai.signOut")!();
    expect(h.auth.clearToken).toHaveBeenCalled();
    expect(clearSpy).toHaveBeenCalled();
  });

  it("signIn runs the OAuth mediation flow and stores the access token", async () => {
    // Stub the full mediation conversation: start → poll-complete → exchange.
    const fetchStub = vi.spyOn(globalThis, "fetch").mockImplementation((async (input: string) => {
      if (input.endsWith("/oauth/figma/start")) {
        return new Response(
          JSON.stringify({ read_key: "rk", authorize_url: "https://api.dev.markup.ai/x" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (input.includes("/oauth/figma/poll")) {
        return new Response(JSON.stringify({ status: "complete", code: "c" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (input.endsWith("/oauth/figma/exchange")) {
        return new Response(JSON.stringify({ access_token: "eyJ.real" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("", { status: 404 });
    }) as typeof fetch);
    vi.spyOn(vscode.env, "openExternal").mockResolvedValue(true);

    const config = {
      getApiBaseUrl: () => "https://api.dev.markup.ai",
    } as unknown as ExtensionConfig;
    const h = makeHarness({ config });
    registerCommands(makeContext(), {
      auth: h.auth,
      config,
      registry: h.registry,
      scanner: h.scanner,
      diagnostics: h.diagnostics,
      logger: h.logger,
      onAgentsRefreshed: h.refreshed,
    });
    await _registeredCommands.get("markupai.signIn")!();
    expect(fetchStub).toHaveBeenCalled();
    expect(h.auth.setToken).toHaveBeenCalledWith("eyJ.real");
    expect(h.registry.refresh).toHaveBeenCalled();
    expect(h.refreshed).toHaveBeenCalled();
  });

  it("refreshAgents notifies the user with the loaded count", async () => {
    const h = makeHarness({
      registry: {
        refresh: vi.fn(async () => [{ slug: "style_agent" }, { slug: "terminology" }]),
        getAll: vi.fn(() => []),
        getBySlug: vi.fn(),
      } as unknown as AgentRegistry,
    });
    const infoSpy = vi.spyOn(vscode.window, "showInformationMessage");
    registerCommands(makeContext(), {
      auth: h.auth,
      config: {} as ExtensionConfig,
      registry: h.registry,
      scanner: h.scanner,
      diagnostics: h.diagnostics,
      logger: h.logger,
      onAgentsRefreshed: h.refreshed,
    });
    await _registeredCommands.get("markupai.refreshAgents")!();
    expect(infoSpy).toHaveBeenCalledWith(expect.stringMatching(/loaded 2 agent/));
  });

  it("refreshAgents surfaces errors via showErrorMessage", async () => {
    const h = makeHarness({
      registry: {
        refresh: vi.fn(async () => {
          throw new Error("boom");
        }),
        getAll: vi.fn(),
        getBySlug: vi.fn(),
      } as unknown as AgentRegistry,
    });
    const errSpy = vi.spyOn(vscode.window, "showErrorMessage");
    registerCommands(makeContext(), {
      auth: h.auth,
      config: {} as ExtensionConfig,
      registry: h.registry,
      scanner: h.scanner,
      diagnostics: h.diagnostics,
      logger: h.logger,
      onAgentsRefreshed: h.refreshed,
    });
    await _registeredCommands.get("markupai.refreshAgents")!();
    expect(errSpy).toHaveBeenCalledWith(expect.stringMatching(/boom/));
  });

  it("_dismissIssues removes issues with the given ids", async () => {
    const h = makeHarness();
    h.diagnostics.setIssuesForAgent(vscode.Uri.file("/tmp/a.md"), "style_agent", [
      {
        id: "keep",
        agent: "style_agent",
        confidence: 1,
        severity: "low",
        explanation: "e",
        position: { start: 0, end: 1 },
      },
      {
        id: "drop",
        agent: "style_agent",
        confidence: 1,
        severity: "low",
        explanation: "e",
        position: { start: 2, end: 3 },
      },
    ]);
    registerCommands(makeContext(), {
      auth: h.auth,
      config: {} as ExtensionConfig,
      registry: h.registry,
      scanner: h.scanner,
      diagnostics: h.diagnostics,
      logger: h.logger,
      onAgentsRefreshed: h.refreshed,
    });
    _registeredCommands.get("markupai._dismissIssues")!(vscode.Uri.file("/tmp/a.md").toString(), [
      "drop",
    ]);
    const remaining = h.diagnostics.getAllIssues(vscode.Uri.file("/tmp/a.md"));
    expect(remaining.map((i) => i.id)).toEqual(["keep"]);
  });
});

describe("scanDocument", () => {
  beforeEach(() => _resetVscodeMock());
  afterEach(() => vi.restoreAllMocks());

  function makeConfig(): ExtensionConfig {
    return {
      getEnabledAgents: () => ENABLED_AGENT_SLUGS,
      getStyleGuideTargetId: () => "",
    } as unknown as ExtensionConfig;
  }

  function makeDoc(fileName: string): vscode.TextDocument {
    return {
      uri: vscode.Uri.file(fileName),
      fileName,
      getText: () => "hello",
    } as unknown as vscode.TextDocument;
  }

  it("rejects unsupported file types with a warning", async () => {
    const warn = vi.spyOn(vscode.window, "showWarningMessage");
    const h = makeHarness();
    await scanDocument(makeDoc("/tmp/a.pdf"), {
      auth: h.auth,
      config: makeConfig(),
      registry: h.registry,
      scanner: h.scanner,
      diagnostics: h.diagnostics,
      logger: h.logger,
      onAgentsRefreshed: h.refreshed,
    });
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/not supported/));
    expect(h.scanner.scan).not.toHaveBeenCalled();
  });

  it("prompts sign-in when no token is stored", async () => {
    const h = makeHarness({
      auth: { hasToken: vi.fn(async () => false) } as unknown as AuthStore,
    });
    const warn = vi.spyOn(vscode.window, "showWarningMessage").mockResolvedValue(undefined);
    await scanDocument(makeDoc("/tmp/a.md"), {
      auth: h.auth,
      config: makeConfig(),
      registry: h.registry,
      scanner: h.scanner,
      diagnostics: h.diagnostics,
      logger: h.logger,
      onAgentsRefreshed: h.refreshed,
    });
    expect(warn).toHaveBeenCalled();
    expect(h.scanner.scan).not.toHaveBeenCalled();
  });

  it("refreshes the registry when empty, then scans", async () => {
    const h = makeHarness({
      registry: {
        getAll: vi.fn(() => []),
        getBySlug: vi.fn(() => ({ slug: "style_agent", internalId: "ag_1" })),
        refresh: vi.fn(async () => []),
      } as unknown as AgentRegistry,
    });
    await scanDocument(makeDoc("/tmp/a.md"), {
      auth: h.auth,
      config: makeConfig(),
      registry: h.registry,
      scanner: h.scanner,
      diagnostics: h.diagnostics,
      logger: h.logger,
      onAgentsRefreshed: h.refreshed,
    });
    expect(h.registry.refresh).toHaveBeenCalled();
    expect(h.scanner.scan).toHaveBeenCalled();
  });

  it("warns when no agents are enabled", async () => {
    const warn = vi.spyOn(vscode.window, "showWarningMessage");
    _configStore["markupai.enabledAgents"] = ["bogus"];
    const h = makeHarness();
    await scanDocument(makeDoc("/tmp/a.md"), {
      auth: h.auth,
      config: {
        getEnabledAgents: () => [],
        getStyleGuideTargetId: () => "",
      } as unknown as ExtensionConfig,
      registry: h.registry,
      scanner: h.scanner,
      diagnostics: h.diagnostics,
      logger: h.logger,
      onAgentsRefreshed: h.refreshed,
    });
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/no agents enabled/));
  });

  it("reports errors from scanner.scan", async () => {
    const scanner = {
      scan: vi.fn(async () => ({
        totalIssues: 0,
        perAgent: {},
        errors: ["api down"],
      })),
    } as unknown as Scanner;
    const warn = vi.spyOn(vscode.window, "showWarningMessage");
    const h = makeHarness({ scanner });
    await scanDocument(makeDoc("/tmp/a.md"), {
      auth: h.auth,
      config: makeConfig(),
      registry: h.registry,
      scanner,
      diagnostics: h.diagnostics,
      logger: h.logger,
      onAgentsRefreshed: h.refreshed,
    });
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/api down/));
  });
});
