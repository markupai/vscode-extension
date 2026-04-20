import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, AuthError, MarkupAIClient, parseSSE } from "../src/apiClient.js";
import type { AuthStore } from "../src/auth.js";
import type { ExtensionConfig } from "../src/config.js";
import type { Logger } from "../src/logger.js";
import type { SSEEvent } from "../src/types.js";

function makeAuth(token: string | undefined): AuthStore {
  return {
    getToken: async () => token,
    hasToken: async () => Boolean(token),
  } as unknown as AuthStore;
}

function makeConfig(base = "https://api.dev.markup.ai"): ExtensionConfig {
  return {
    getApiBaseUrl: () => base,
    getEnvironment: () => "dev" as const,
  } as unknown as ExtensionConfig;
}

function makeLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;
}

function jsonResponse(body: unknown, init: { status?: number } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("MarkupAIClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("throws AuthError when no token is stored", async () => {
    const client = new MarkupAIClient(makeConfig(), makeAuth(undefined), makeLogger(), "0.0.1");
    await expect(client.listAgents()).rejects.toBeInstanceOf(AuthError);
  });

  it("listAgents sends bearer + integration headers", async () => {
    const fetchSpy: typeof fetch = vi.fn(async () => jsonResponse({ data: [] }));
    const client = new MarkupAIClient(
      makeConfig(),
      makeAuth("mat_abc"),
      makeLogger(),
      "1.2.3",
      fetchSpy,
    );
    await client.listAgents();
    const mock = vi.mocked(fetchSpy);
    expect(mock).toHaveBeenCalledOnce();
    const [url, init] = mock.mock.calls[0];
    expect(String(url)).toContain("/agents/list");
    const headers = init!.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer mat_abc");
    expect(headers["x-integration-version"]).toBe("1.2.3");
  });

  it("runAgents posts to the parallel-executor endpoint with body", async () => {
    const fetchSpy: typeof fetch = vi.fn(async () =>
      jsonResponse({ data: { workflow_id: "wf_1" } }),
    );
    const client = new MarkupAIClient(
      makeConfig(),
      makeAuth("mat_abc"),
      makeLogger(),
      "1.0.0",
      fetchSpy,
    );
    const res = await client.runAgents({
      internalIds: ["ag_1"],
      text: "hi",
      contentProfile: "markdown",
      agentConfig: {},
    });
    expect(res.data.workflow_id).toBe("wf_1");
    const [, init] = vi.mocked(fetchSpy).mock.calls[0];
    expect(init!.method).toBe("POST");
    const body = JSON.parse(String(init!.body));
    expect(body.agents).toEqual(["ag_1"]);
    expect(body.content_profile_id).toBe("markdown");
  });

  it("maps 401 to AuthError", async () => {
    const fetchSpy: typeof fetch = vi.fn(async () => new Response("nope", { status: 401 }));
    const client = new MarkupAIClient(
      makeConfig(),
      makeAuth("mat_abc"),
      makeLogger(),
      "0.0.1",
      fetchSpy,
    );
    await expect(client.listAgents()).rejects.toBeInstanceOf(AuthError);
  });

  it("maps 500 to ApiError", async () => {
    const fetchSpy: typeof fetch = vi.fn(async () => new Response("boom", { status: 500 }));
    const client = new MarkupAIClient(
      makeConfig(),
      makeAuth("mat_abc"),
      makeLogger(),
      "0.0.1",
      fetchSpy,
    );
    await expect(client.listAgents()).rejects.toBeInstanceOf(ApiError);
  });

  it("streamWorkflow yields parsed SSE events", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder();
        controller.enqueue(enc.encode('data: {"type":"status","status":"starting"}\n\n'));
        controller.enqueue(
          enc.encode(
            'data: {"type":"agent_result","agent_name":"ag_1","success":true,"result":{"issues":[]}}\n\n',
          ),
        );
        controller.enqueue(enc.encode('data: {"type":"completion"}\n\n'));
        controller.close();
      },
    });
    const fetchSpy: typeof fetch = vi.fn(async () => new Response(body, { status: 200 }));
    const client = new MarkupAIClient(
      makeConfig(),
      makeAuth("mat_abc"),
      makeLogger(),
      "0.0.1",
      fetchSpy,
    );
    const events: SSEEvent[] = [];
    for await (const ev of client.streamWorkflow("wf_1")) events.push(ev);
    expect(events.map((e) => e.type)).toEqual(["status", "agent_result", "completion"]);
  });
});

describe("parseSSE", () => {
  function stream(chunks: string[]): ReadableStream<Uint8Array> {
    const enc = new TextEncoder();
    return new ReadableStream({
      start(controller) {
        for (const c of chunks) controller.enqueue(enc.encode(c));
        controller.close();
      },
    });
  }

  it("parses events split across chunks", async () => {
    const events: SSEEvent[] = [];
    for await (const ev of parseSSE(stream(['data: {"type":"stat', 'us","status":"ok"}\n\n']))) {
      events.push(ev);
    }
    expect(events).toEqual([{ type: "status", status: "ok" }]);
  });

  it("ignores comments and [DONE] sentinels", async () => {
    const events: SSEEvent[] = [];
    for await (const ev of parseSSE(stream([": heartbeat\n\ndata: [DONE]\n\n"]))) events.push(ev);
    expect(events).toEqual([]);
  });

  it("ignores malformed JSON", async () => {
    const events: SSEEvent[] = [];
    for await (const ev of parseSSE(stream(["data: {not json}\n\n"]))) events.push(ev);
    expect(events).toEqual([]);
  });
});
