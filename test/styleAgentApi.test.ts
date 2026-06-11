import { describe, it, expect, vi } from "vitest";
import { StyleAgentClient, ApiError, AuthError } from "../src/styleAgentApi";
import { MAX_TEXT_LENGTH } from "../src/constants";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function createClient(fetchImpl: typeof fetch, token: string | null = "tok-123") {
  return new StyleAgentClient({
    baseUrl: "https://api.example.com/",
    getToken: () => Promise.resolve(token ?? undefined),
    fetchImpl,
    pollIntervalMs: 1,
    pollTimeoutMs: 200,
  });
}

describe("StyleAgentClient", () => {
  describe("request handling", () => {
    it("sends bearer token and integration headers", async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        jsonResponse({
          is_acrolinx_classic: false,
          style_agent: "enabled",
          style_agent_numeric_scoring: false,
        }),
      );
      const client = createClient(fetchMock);

      await client.getConfig();

      expect(fetchMock).toHaveBeenCalledWith(
        "https://api.example.com/style-agent/config",
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            Authorization: "Bearer tok-123",
            "x-integration-id": "vscode_extension",
          }) as Record<string, string>,
        }),
      );
    });

    it("throws AuthError without making a request when no token", async () => {
      const fetchMock = vi.fn();
      const client = createClient(fetchMock, null);

      await expect(client.getConfig()).rejects.toBeInstanceOf(AuthError);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("throws AuthError on 401 responses", async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ message: "expired" }, 401));
      const client = createClient(fetchMock);

      await expect(client.getConfig()).rejects.toBeInstanceOf(AuthError);
    });

    it("throws ApiError with the server message on other failures", async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ detail: "boom" }, 500));
      const client = createClient(fetchMock);

      const error = await client.getConfig().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(500);
      expect((error as ApiError).message).toContain("boom");
    });
  });

  describe("listStyleGuides", () => {
    it("returns only enabled style guides", async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        jsonResponse([
          { id: "sg-1", display_name: "Default", is_default: true, enabled: true },
          { id: "sg-2", display_name: "Disabled", is_default: false, enabled: false },
        ]),
      );
      const client = createClient(fetchMock);

      const guides = await client.listStyleGuides();

      expect(guides).toHaveLength(1);
      expect(guides[0].id).toBe("sg-1");
    });

    it("falls back to /style-agent/targets when style-guides is 404 (prod)", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ detail: "Not Found" }, 404))
        .mockResolvedValueOnce(
          jsonResponse([{ id: "t-1", display_name: "Target", is_default: true, enabled: true }]),
        );
      const client = createClient(fetchMock);

      const guides = await client.listStyleGuides();

      expect(guides).toHaveLength(1);
      expect(guides[0].id).toBe("t-1");
      const [fallbackUrl] = fetchMock.mock.calls[1] as [string];
      expect(fallbackUrl).toBe("https://api.example.com/style-agent/targets");
    });

    it("does not swallow non-404 errors from style guide listing", async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ message: "boom" }, 500));
      const client = createClient(fetchMock);

      await expect(client.listStyleGuides()).rejects.toBeInstanceOf(ApiError);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("runCheck", () => {
    const completedWorkflow = {
      workflow_id: "agw_1",
      status: "completed",
      result: {
        issues: [
          {
            severity: "high",
            category: "Spelling",
            explanation: "Fix it",
            position: { start: 0, end: 4, text: "this" },
            suggestion: "This",
          },
        ],
        analysis: null,
      },
      started_at: "2026-01-01T00:00:00Z",
    };

    it("posts text and style guide id, then polls to completion", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ workflow_id: "agw_1", status: "running" }, 202))
        .mockResolvedValueOnce(jsonResponse({ workflow_id: "agw_1", status: "running" }))
        .mockResolvedValueOnce(jsonResponse(completedWorkflow));
      const client = createClient(fetchMock);

      const workflow = await client.runCheck({
        text: "this is text",
        styleGuideId: "sg-1",
        documentName: "sample.md",
      });

      expect(workflow.status).toBe("completed");
      expect(workflow.result?.issues).toHaveLength(1);

      const [runUrl, runInit] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(runUrl).toBe("https://api.example.com/style-agent/run?wait=false");
      // target_id, not style_guide_id — prod only accepts the legacy name.
      expect(JSON.parse(runInit.body as string)).toEqual({
        text: "this is text",
        target_id: "sg-1",
        document_name: "sample.md",
      });

      const [pollUrl] = fetchMock.mock.calls[1] as [string];
      expect(pollUrl).toBe("https://api.example.com/style-agent/workflows/agw_1");
    });

    it("returns immediately when the run response is already terminal", async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(completedWorkflow));
      const client = createClient(fetchMock);

      const workflow = await client.runCheck({ text: "short" });

      expect(workflow.status).toBe("completed");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("continues polling through a transient 404", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ workflow_id: "agw_1", status: "running" }, 202))
        .mockResolvedValueOnce(jsonResponse({ message: "not found" }, 404))
        .mockResolvedValueOnce(jsonResponse(completedWorkflow));
      const client = createClient(fetchMock);

      const workflow = await client.runCheck({ text: "text" });

      expect(workflow.status).toBe("completed");
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it("throws when the workflow fails", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ workflow_id: "agw_1", status: "running" }, 202))
        .mockResolvedValueOnce(jsonResponse({ workflow_id: "agw_1", status: "failed" }));
      const client = createClient(fetchMock);

      await expect(client.runCheck({ text: "text" })).rejects.toThrow("content check failed");
    });

    it("throws when polling exceeds the timeout", async () => {
      const fetchMock = vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(jsonResponse({ workflow_id: "agw_1", status: "running" })),
        );
      const client = new StyleAgentClient({
        baseUrl: "https://api.example.com",
        getToken: () => Promise.resolve("tok"),
        fetchImpl: fetchMock,
        pollIntervalMs: 5,
        pollTimeoutMs: 20,
      });

      await expect(client.runCheck({ text: "text" })).rejects.toThrow("timed out");
    });

    it("rejects oversized documents before calling the API", async () => {
      const fetchMock = vi.fn();
      const client = createClient(fetchMock);

      await expect(client.runCheck({ text: "x".repeat(MAX_TEXT_LENGTH + 1) })).rejects.toThrow(
        "too large",
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("propagates auth errors raised during polling", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ workflow_id: "agw_1", status: "running" }, 202))
        .mockResolvedValueOnce(jsonResponse({ message: "expired" }, 401));
      const client = createClient(fetchMock);

      await expect(client.runCheck({ text: "text" })).rejects.toBeInstanceOf(AuthError);
    });
  });
});
