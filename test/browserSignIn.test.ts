import { describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import {
  isBrowserSignInAvailable,
  runBrowserSignIn,
  type BrowserSignInOptions,
  type BrowserSignInResult,
} from "../src/browserSignIn";

function jsonOk(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function notOk(status = 500): Response {
  return new Response("err", { status });
}

function urlOf(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") {
    return input;
  }
  return input instanceof URL ? input.toString() : input.url;
}

/** Builds a fetch stub from a synchronous URL → Response handler. */
function fakeFetch(handler: (url: string) => Response): typeof fetch {
  return (input: Parameters<typeof fetch>[0]) => Promise.resolve(handler(urlOf(input)));
}

const BASE = "https://api.dev.markup.ai";
const PROVIDER = "vscode-extension";

function signIn(
  fetchImpl: typeof fetch,
  opts: Partial<BrowserSignInOptions> = {},
): Promise<BrowserSignInResult> {
  return runBrowserSignIn({
    apiBaseUrl: BASE,
    provider: PROVIDER,
    fetchImpl,
    openExternal: () => Promise.resolve(true),
    timeoutMs: 400,
    pollIntervalMs: 10,
    ...opts,
  });
}

describe("isBrowserSignInAvailable", () => {
  it("is true when fetch + openExternal exist (both desktop and web hosts)", () => {
    expect(isBrowserSignInAvailable()).toBe(true);
  });
});

describe("runBrowserSignIn", () => {
  it("happy path: start → poll-pending → poll-complete → exchange", async () => {
    const calls: string[] = [];
    const fetchImpl = fakeFetch((url) => {
      calls.push(url);
      if (url.endsWith("/oauth/vscode-extension/start")) {
        return jsonOk({
          read_key: "rk_123",
          authorize_url: "https://api.dev.markup.ai/oauth/vscode-extension/authorize?state=abc",
        });
      }
      if (url.includes("/oauth/vscode-extension/poll")) {
        const pollCount = calls.filter((c) => c.includes("/poll")).length;
        if (pollCount === 1) {
          return jsonOk({ status: "pending" });
        }
        return jsonOk({ status: "complete", code: "auth_code_abc" });
      }
      if (url.endsWith("/oauth/vscode-extension/exchange")) {
        return jsonOk({
          access_token: "eyJ.real",
          expires_in: 3600,
          refresh_token: "rt_xyz",
        });
      }
      return notOk(404);
    });

    const result = await signIn(fetchImpl);
    expect(result.accessToken).toBe("eyJ.real");
    expect(result.expiresIn).toBe(3600);
    expect(result.refreshToken).toBe("rt_xyz");
    const exchange = calls.at(-1) ?? "";
    expect(exchange).toContain("/oauth/vscode-extension/exchange");
  });

  it("opens the authorize_url from /start in the user's browser", async () => {
    let openedUri: vscode.Uri | undefined;
    const openExternal = vi.fn((uri: vscode.Uri) => {
      openedUri = uri;
      return Promise.resolve(true);
    });
    const fetchImpl = fakeFetch((url) => {
      if (url.endsWith("/start")) {
        return jsonOk({
          readKey: "rk",
          authorizeUrl: "https://api.dev.markup.ai/oauth/vscode-extension/authorize?state=S-xyz",
        });
      }
      if (url.includes("/poll")) {
        return jsonOk({ status: "complete", code: "c" });
      }
      if (url.endsWith("/exchange")) {
        return jsonOk({ access_token: "at" });
      }
      return notOk();
    });
    await signIn(fetchImpl, { openExternal });
    expect(openExternal).toHaveBeenCalledOnce();
    expect(openedUri?.toString()).toContain("/oauth/vscode-extension/authorize");
    expect(openedUri?.toString()).toContain("state=S-xyz");
  });

  it("rejects when /start returns a non-OK status", async () => {
    const fetchImpl = fakeFetch(() => notOk(500));
    await expect(signIn(fetchImpl)).rejects.toThrow(/failed to start OAuth flow/);
  });

  it("rejects when the poll reports status=error", async () => {
    let polled = false;
    const fetchImpl = fakeFetch((url) => {
      if (url.endsWith("/start")) {
        return jsonOk({ read_key: "rk", authorize_url: "https://x/" });
      }
      if (url.includes("/poll")) {
        polled = true;
        return jsonOk({ status: "error", error: "user cancelled" });
      }
      return notOk();
    });
    await expect(signIn(fetchImpl)).rejects.toThrow(/user cancelled/);
    expect(polled).toBe(true);
  });

  it("times out when /poll keeps returning pending", async () => {
    const fetchImpl = fakeFetch((url) => {
      if (url.endsWith("/start")) {
        return jsonOk({ read_key: "rk", authorize_url: "https://x/" });
      }
      if (url.includes("/poll")) {
        return jsonOk({ status: "pending" });
      }
      return notOk();
    });
    await expect(signIn(fetchImpl, { timeoutMs: 150 })).rejects.toThrow(/timed out/);
  });

  it("rejects when /exchange returns a non-OK status", async () => {
    const fetchImpl = fakeFetch((url) => {
      if (url.endsWith("/start")) {
        return jsonOk({ read_key: "rk", authorize_url: "https://x/" });
      }
      if (url.includes("/poll")) {
        return jsonOk({ status: "complete", code: "c" });
      }
      if (url.endsWith("/exchange")) {
        return notOk(400);
      }
      return notOk();
    });
    await expect(signIn(fetchImpl)).rejects.toThrow(/token exchange failed/);
  });

  it("surfaces a clear error when openExternal fails", async () => {
    const fetchImpl = fakeFetch((url) => {
      if (url.endsWith("/start")) {
        return jsonOk({ read_key: "rk", authorize_url: "https://x/" });
      }
      return notOk();
    });
    await expect(signIn(fetchImpl, { openExternal: () => Promise.resolve(false) })).rejects.toThrow(
      /could not open the browser/,
    );
  });

  it("tolerates transient poll errors and eventually succeeds", async () => {
    let pollCount = 0;
    const fetchImpl = fakeFetch((url) => {
      if (url.endsWith("/start")) {
        return jsonOk({ read_key: "rk", authorize_url: "https://x/" });
      }
      if (url.includes("/poll")) {
        pollCount++;
        if (pollCount === 1) {
          return notOk(502); // transient
        }
        return jsonOk({ status: "complete", code: "c" });
      }
      if (url.endsWith("/exchange")) {
        return jsonOk({ access_token: "at" });
      }
      return notOk();
    });
    const result = await signIn(fetchImpl);
    expect(result.accessToken).toBe("at");
    expect(pollCount).toBeGreaterThanOrEqual(2);
  });
});
