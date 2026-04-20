import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import type { MarkupAIClient } from "../src/apiClient.js";
import { DiagnosticsManager } from "../src/diagnostics.js";
import { AgentRegistry } from "../src/agentRegistry.js";
import { Logger } from "../src/logger.js";
import { Scanner } from "../src/scanner.js";
import type { Issue, SSEEvent } from "../src/types.js";

function makeLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;
}

function fakeRegistry(
  agents: { slug: string; internalId: string; displayName?: string }[],
): AgentRegistry {
  return {
    getAll: () => agents,
    getBySlug: (slug: string) => agents.find((a) => a.slug === slug),
  } as unknown as AgentRegistry;
}

function fakeClient(opts: {
  workflowId?: string;
  events?: SSEEvent[];
  runThrows?: Error;
}): MarkupAIClient {
  return {
    runAgents: vi.fn(async () => {
      if (opts.runThrows) throw opts.runThrows;
      return { workflow_id: opts.workflowId ?? "wf_1" };
    }),
    streamWorkflow: async function* () {
      for (const ev of opts.events ?? []) yield ev;
    },
  } as unknown as MarkupAIClient;
}

const styleIssue: Issue = {
  agent: "ag_style",
  confidence: 0.9,
  severity: "medium",
  explanation: "use active voice",
  position: { start: 0, end: 5 },
};

describe("Scanner", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("returns early with a friendly error when no agents resolve", async () => {
    const scanner = new Scanner(
      fakeClient({}),
      fakeRegistry([]),
      new DiagnosticsManager(),
      makeLogger(),
    );
    const result = await scanner.scan({
      uri: vscode.Uri.file("/tmp/a.md"),
      text: "hi",
      fileName: "a.md",
      agentSlugs: ["style_agent"],
      agentConfig: {},
    });
    expect(result.errors[0]).toMatch(/No enabled agents/);
    expect(result.totalIssues).toBe(0);
  });

  it("runs one bucket for markdown input, publishes issues via diagnostics", async () => {
    const client = fakeClient({
      events: [
        {
          type: "agent_result",
          agent_name: "ag_style",
          success: true,
          result: { issues: [styleIssue] },
        },
        { type: "completion" },
      ],
    });
    const registry = fakeRegistry([
      { slug: "style_agent", internalId: "ag_style" },
      { slug: "terminology", internalId: "ag_term" },
    ]);
    const diag = new DiagnosticsManager();
    const scanner = new Scanner(client, registry, diag, makeLogger());
    const progress: { agentSlug: string; issues: readonly unknown[] }[] = [];
    const result = await scanner.scan({
      uri: vscode.Uri.file("/tmp/a.md"),
      text: "hello world",
      fileName: "a.md",
      agentSlugs: ["style_agent", "terminology"],
      agentConfig: {},
      onProgress: (info) => progress.push(info),
    });
    expect(result.totalIssues).toBe(1);
    expect(result.perAgent.style_agent).toHaveLength(1);
    expect(progress).toHaveLength(1);
    expect((client.runAgents as any).mock.calls).toHaveLength(1);
  });

  it("splits DITA + style agent into two buckets with different profiles", async () => {
    const client = fakeClient({
      events: [{ type: "completion" }],
    });
    const registry = fakeRegistry([
      { slug: "style_agent", internalId: "ag_style" },
      { slug: "terminology", internalId: "ag_term" },
    ]);
    const scanner = new Scanner(client, registry, new DiagnosticsManager(), makeLogger());
    await scanner.scan({
      uri: vscode.Uri.file("/tmp/a.dita"),
      text: "<title>t</title>",
      fileName: "a.dita",
      agentSlugs: ["style_agent", "terminology"],
      agentConfig: {},
    });
    const calls = (client.runAgents as any).mock.calls;
    expect(calls).toHaveLength(2);
    const profiles = calls.map((c: any) => c[0].contentProfile).sort();
    expect(profiles).toEqual(["dita", "markdown"]);
  });

  it("captures sse error events and surfaces them as strings", async () => {
    const client = fakeClient({
      events: [{ type: "error", error: "oops" }, { type: "completion" }],
    });
    const registry = fakeRegistry([{ slug: "style_agent", internalId: "ag_style" }]);
    const scanner = new Scanner(client, registry, new DiagnosticsManager(), makeLogger());
    const result = await scanner.scan({
      uri: vscode.Uri.file("/tmp/a.md"),
      text: "hi",
      fileName: "a.md",
      agentSlugs: ["style_agent"],
      agentConfig: {},
    });
    expect(result.errors).toContain("oops");
  });

  it("records failed agent_result events as errors", async () => {
    const client = fakeClient({
      events: [
        { type: "agent_result", agent_name: "ag_style", success: false, error: "bad" },
        { type: "completion" },
      ],
    });
    const registry = fakeRegistry([{ slug: "style_agent", internalId: "ag_style" }]);
    const scanner = new Scanner(client, registry, new DiagnosticsManager(), makeLogger());
    const result = await scanner.scan({
      uri: vscode.Uri.file("/tmp/a.md"),
      text: "hi",
      fileName: "a.md",
      agentSlugs: ["style_agent"],
      agentConfig: {},
    });
    expect(result.errors.join(" ")).toMatch(/bad/);
  });

  it("catches and reports exceptions thrown by runAgents", async () => {
    const client = fakeClient({ runThrows: new Error("network down") });
    const registry = fakeRegistry([{ slug: "style_agent", internalId: "ag_style" }]);
    const scanner = new Scanner(client, registry, new DiagnosticsManager(), makeLogger());
    const result = await scanner.scan({
      uri: vscode.Uri.file("/tmp/a.md"),
      text: "hi",
      fileName: "a.md",
      agentSlugs: ["style_agent"],
      agentConfig: {},
    });
    expect(result.errors.join(" ")).toMatch(/network down/);
  });
});
