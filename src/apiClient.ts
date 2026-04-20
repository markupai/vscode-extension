import { INTEGRATION_ID, PARALLEL_EXECUTOR_AGENT_ID, USER_MESSAGE_PREFIX } from "./constants.js";
import type { AuthStore } from "./auth.js";
import type { ExtensionConfig } from "./config.js";
import type { Logger } from "./logger.js";
import type { AgentConfig, AgentListResponse, AgentRunResponse, SSEEvent } from "./types.js";

export interface RunAgentsRequest {
  readonly internalIds: readonly string[];
  readonly text: string;
  readonly contentProfile: "markdown" | "dita";
  readonly agentConfig: AgentConfig;
  readonly documentName?: string;
  readonly documentRef?: string;
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type FetchFn = typeof fetch;

/**
 * Thin, web-compatible MarkupAI API client. Uses the platform `fetch`
 * (available in Node 18+ and in browser/worker contexts) and streams
 * SSE via `ReadableStream` so no Node-only modules are required.
 */
export class MarkupAIClient {
  constructor(
    private readonly config: ExtensionConfig,
    private readonly auth: AuthStore,
    private readonly logger: Logger,
    private readonly extensionVersion: string,
    private readonly fetchImpl: FetchFn = fetch,
  ) {}

  private async authHeaders(): Promise<Record<string, string>> {
    const token = await this.auth.getToken();
    if (!token) {
      throw new AuthError(`${USER_MESSAGE_PREFIX}not signed in. Run 'MarkupAI: Sign In' first.`);
    }
    return {
      Authorization: `Bearer ${token}`,
      "x-integration-id": INTEGRATION_ID,
      "x-integration-version": this.extensionVersion,
    };
  }

  async listAgents(signal?: AbortSignal): Promise<AgentListResponse> {
    const url = `${this.config.getApiBaseUrl()}/agents/list?page_size=100`;
    const headers = await this.authHeaders();
    this.logger.debug("GET", url);
    const res = await this.fetchImpl(url, {
      method: "GET",
      headers: { ...headers, Accept: "application/json" },
      signal,
    });
    return this.handleJson<AgentListResponse>(res);
  }

  async runAgents(req: RunAgentsRequest, signal?: AbortSignal): Promise<AgentRunResponse> {
    const url = `${this.config.getApiBaseUrl()}/agents/${PARALLEL_EXECUTOR_AGENT_ID}/run?wait=false`;
    const headers = await this.authHeaders();
    const body = {
      agents: req.internalIds,
      text: req.text,
      content_profile_id: req.contentProfile,
      document_ref: req.documentRef,
      document_name: req.documentName,
      ...req.agentConfig,
    };
    this.logger.debug("POST", url, { agents: req.internalIds, len: req.text.length });
    const res = await this.fetchImpl(url, {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      signal,
    });
    return this.handleJson<AgentRunResponse>(res);
  }

  async *streamWorkflow(workflowId: string, signal?: AbortSignal): AsyncGenerator<SSEEvent> {
    const url = `${this.config.getApiBaseUrl()}/agents/workflows/${workflowId}/stream`;
    const headers = await this.authHeaders();
    this.logger.debug("SSE", url);
    const res = await this.fetchImpl(url, {
      method: "GET",
      headers: { ...headers, Accept: "text/event-stream" },
      signal,
    });
    if (!res.ok || !res.body) {
      const text = await safeText(res);
      throw new ApiError(`SSE stream failed (${res.status})`, res.status, text);
    }
    for await (const event of parseSSE(res.body)) {
      yield event;
    }
  }

  private async handleJson<T>(res: Response): Promise<T> {
    if (res.status === 401 || res.status === 403) {
      throw new AuthError(
        `${USER_MESSAGE_PREFIX}authentication failed (${res.status}). Check your token.`,
      );
    }
    if (!res.ok) {
      const text = await safeText(res);
      throw new ApiError(`Request failed (${res.status})`, res.status, text);
    }
    return (await res.json()) as T;
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

/**
 * Parse a Server-Sent Events byte stream into structured events.
 * Uses only standard web APIs — works in both Node 18+ and browser.
 */
export async function* parseSSE(stream: ReadableStream<Uint8Array>): AsyncGenerator<SSEEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sepIndex: number;
      while ((sepIndex = findEventEnd(buffer)) !== -1) {
        const raw = buffer.slice(0, sepIndex);
        buffer = buffer.slice(sepIndex).replace(/^(\r?\n){1,2}/, "");
        const ev = parseEventBlock(raw);
        if (ev) yield ev;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function findEventEnd(buf: string): number {
  const a = buf.indexOf("\n\n");
  const b = buf.indexOf("\r\n\r\n");
  if (a === -1) return b;
  if (b === -1) return a;
  return Math.min(a, b);
}

function parseEventBlock(block: string): SSEEvent | null {
  const dataLines: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith(":")) continue;
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }
  if (!dataLines.length) return null;
  const data = dataLines.join("\n");
  if (!data || data === "[DONE]") return null;
  try {
    const parsed = JSON.parse(data) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "type" in parsed &&
      typeof (parsed as Record<string, unknown>).type === "string"
    ) {
      return parsed as SSEEvent;
    }
    return null;
  } catch {
    return null;
  }
}
