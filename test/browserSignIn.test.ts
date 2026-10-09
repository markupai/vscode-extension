import { afterEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import {
  DEFAULT_TIMEOUT_MS,
  isBrowserSignInAvailable,
  runBrowserSignIn,
  SIGN_IN_EXPIRED_MESSAGE,
  SignInCancelledError,
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
  afterEach(() => {
    vi.useRealTimers();
  });

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

  it("waits five minutes by default: the relay's state TTL", () => {
    // Two minutes used to be the limit. The wait now covers the Auth0 login, the
    // organization picker, and reading and typing the confirmation code.
    expect(DEFAULT_TIMEOUT_MS).toBe(300_000);
  });

  it("reports the relay's user_code before the browser opens", async () => {
    const order: string[] = [];
    const fetchImpl = fakeFetch((url) => {
      if (url.endsWith("/start")) {
        return jsonOk({ read_key: "rk", authorize_url: "https://x/", user_code: "BCDF-GHJK" });
      }
      if (url.includes("/poll")) {
        return jsonOk({ status: "complete", code: "c" });
      }
      if (url.endsWith("/exchange")) {
        return jsonOk({ access_token: "at" });
      }
      return notOk();
    });

    await signIn(fetchImpl, {
      onUserCode: (code) => {
        order.push(`code:${code}`);
      },
      openExternal: () => {
        order.push("open");
        return Promise.resolve(true);
      },
    });

    // The code must be on screen by the time the user can reach the confirmation page.
    expect(order).toEqual(["code:BCDF-GHJK", "open"]);
  });

  it("accepts a camelCase userCode", async () => {
    const codes: string[] = [];
    const fetchImpl = fakeFetch((url) => {
      if (url.endsWith("/start")) {
        return jsonOk({ readKey: "rk", authorizeUrl: "https://x/", userCode: "MNPQ-RSTV" });
      }
      if (url.includes("/poll")) {
        return jsonOk({ status: "complete", code: "c" });
      }
      if (url.endsWith("/exchange")) {
        return jsonOk({ access_token: "at" });
      }
      return notOk();
    });
    await signIn(fetchImpl, { onUserCode: (code) => codes.push(code) });
    expect(codes).toEqual(["MNPQ-RSTV"]);
  });

  it("ignores an empty userCode and reports the user_code beside it", async () => {
    const onUserCode = vi.fn();
    const fetchImpl = fakeFetch((url) => {
      if (url.endsWith("/start")) {
        return jsonOk({
          read_key: "rk",
          authorize_url: "https://x/",
          userCode: "",
          user_code: " WXYZ-2345 ",
        });
      }
      if (url.includes("/poll")) {
        return jsonOk({ status: "complete", code: "c" });
      }
      return jsonOk({ access_token: "at" });
    });
    await signIn(fetchImpl, { onUserCode });
    expect(onUserCode).toHaveBeenCalledWith("WXYZ-2345");
  });

  it("does not report a code that is not a string, and still signs in", async () => {
    const onUserCode = vi.fn();
    const fetchImpl = fakeFetch((url) => {
      if (url.endsWith("/start")) {
        return jsonOk({ read_key: "rk", authorize_url: "https://x/", user_code: 12345 });
      }
      if (url.includes("/poll")) {
        return jsonOk({ status: "complete", code: "c" });
      }
      return jsonOk({ access_token: "at" });
    });
    await expect(signIn(fetchImpl, { onUserCode })).resolves.toMatchObject({ accessToken: "at" });
    expect(onUserCode).not.toHaveBeenCalled();
  });

  it("does not report a code, and still signs in, when the relay returns none", async () => {
    const onUserCode = vi.fn();
    const fetchImpl = fakeFetch((url) => {
      if (url.endsWith("/start")) {
        return jsonOk({ read_key: "rk", authorize_url: "https://x/" });
      }
      if (url.includes("/poll")) {
        return jsonOk({ status: "complete", code: "c" });
      }
      if (url.endsWith("/exchange")) {
        return jsonOk({ access_token: "at" });
      }
      return notOk();
    });
    const result = await signIn(fetchImpl, { onUserCode });
    expect(result.accessToken).toBe("at");
    expect(onUserCode).not.toHaveBeenCalled();
  });

  it("fails at once when /poll answers 400 (read key invalid or expired)", async () => {
    let polls = 0;
    const fetchImpl = fakeFetch((url) => {
      if (url.endsWith("/start")) {
        return jsonOk({ read_key: "rk", authorize_url: "https://x/" });
      }
      if (url.includes("/poll")) {
        polls++;
        return new Response(JSON.stringify({ status: "error", error: "Invalid read key." }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }
      return notOk();
    });
    // A generous timeout: the rejection must come from the 400, not the deadline.
    // The relay's own wording ("Invalid read key.") stays out of the message.
    await expect(signIn(fetchImpl, { timeoutMs: 5_000 })).rejects.toThrow(SIGN_IN_EXPIRED_MESSAGE);
    expect(polls).toBe(1);
  });

  it("a 400 without an error field, or with a non-string one, reads the same", async () => {
    const bodies = [{}, { status: "error", error: "" }, { status: "error", error: { code: 7 } }];
    for (const body of bodies) {
      const fetchImpl = fakeFetch((url) => {
        if (url.endsWith("/start")) {
          return jsonOk({ read_key: "rk", authorize_url: "https://x/" });
        }
        if (url.includes("/poll")) {
          return new Response(JSON.stringify(body), { status: 400 });
        }
        return notOk();
      });
      await expect(signIn(fetchImpl, { timeoutMs: 5_000 })).rejects.toThrow(
        SIGN_IN_EXPIRED_MESSAGE,
      );
    }
  });

  it("keeps polling when a 200 poll has no JSON body", async () => {
    let polls = 0;
    const fetchImpl = fakeFetch((url) => {
      if (url.endsWith("/start")) {
        return jsonOk({ read_key: "rk", authorize_url: "https://x/" });
      }
      if (url.includes("/poll")) {
        polls++;
        return polls === 1
          ? new Response("<html>proxy page</html>", { status: 200 })
          : jsonOk({ status: "complete", code: "c" });
      }
      if (url.endsWith("/exchange")) {
        return jsonOk({ access_token: "at" });
      }
      return notOk();
    });
    await expect(signIn(fetchImpl)).resolves.toMatchObject({ accessToken: "at" });
    expect(polls).toBe(2);
  });

  it("keeps polling when a poll request itself fails (dropped connection)", async () => {
    let polls = 0;
    const fetchImpl: typeof fetch = (input) => {
      const url = urlOf(input);
      if (url.endsWith("/start")) {
        return Promise.resolve(jsonOk({ read_key: "rk", authorize_url: "https://x/" }));
      }
      if (url.includes("/poll")) {
        polls++;
        return polls <= 2
          ? Promise.reject(new TypeError("fetch failed"))
          : Promise.resolve(jsonOk({ status: "complete", code: "c" }));
      }
      return Promise.resolve(jsonOk({ access_token: "at" }));
    };
    await expect(signIn(fetchImpl)).resolves.toMatchObject({ accessToken: "at" });
    expect(polls).toBe(3);
  });

  it("abandons a stalled poll request after the per-request timeout and retries", async () => {
    let polls = 0;
    const fetchImpl: typeof fetch = (input, init) => {
      const url = urlOf(input);
      if (url.endsWith("/start")) {
        return Promise.resolve(jsonOk({ read_key: "rk", authorize_url: "https://x/" }));
      }
      if (url.includes("/poll")) {
        polls++;
        if (polls === 1) {
          // Hangs until its signal aborts, as a real fetch would.
          return new Promise((_, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("aborted", "AbortError"));
            });
          });
        }
        return Promise.resolve(jsonOk({ status: "complete", code: "c" }));
      }
      return Promise.resolve(jsonOk({ access_token: "at" }));
    };
    await expect(
      signIn(fetchImpl, { requestTimeoutMs: 30, timeoutMs: 2_000 }),
    ).resolves.toMatchObject({ accessToken: "at" });
    expect(polls).toBe(2);
  });

  it("passes the caller's signal to every relay request", async () => {
    const signals: (AbortSignal | null | undefined)[] = [];
    const fetchImpl: typeof fetch = (input, init) => {
      signals.push(init?.signal);
      const url = urlOf(input);
      if (url.endsWith("/start")) {
        return Promise.resolve(jsonOk({ read_key: "rk", authorize_url: "https://x/" }));
      }
      if (url.includes("/poll")) {
        return Promise.resolve(jsonOk({ status: "complete", code: "c" }));
      }
      return Promise.resolve(jsonOk({ access_token: "at" }));
    };
    const cancel = new AbortController();
    await signIn(fetchImpl, { signal: cancel.signal });

    expect(signals).toHaveLength(3);
    for (const signal of signals) {
      expect(signal).toBeInstanceOf(AbortSignal);
      expect(signal?.aborted).toBe(false);
    }
    cancel.abort();
    // Each request signal follows the caller's.
    for (const signal of signals) {
      expect(signal?.aborted).toBe(true);
    }
  });

  it("uses the five-minute wait when no timeout is given", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let polls = 0;
    const fetchImpl = fakeFetch((url) => {
      if (url.endsWith("/start")) {
        return jsonOk({ read_key: "rk", authorize_url: "https://x/" });
      }
      if (url.includes("/poll")) {
        polls++;
        return jsonOk({ status: "pending" });
      }
      return notOk();
    });
    let settled = false;
    const pending = runBrowserSignIn({
      apiBaseUrl: BASE,
      provider: PROVIDER,
      fetchImpl,
      openExternal: () => Promise.resolve(true),
    });
    const assertion = expect(pending).rejects.toThrow(/timed out/);
    void pending.catch(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(298_000);
    expect(settled).toBe(false);
    expect(polls).toBeGreaterThan(140);

    await vi.advanceTimersByTimeAsync(4_000);
    expect(settled).toBe(true);
    await assertion;
  });

  it("ends the wait at once with SignInCancelledError when the signal aborts", async () => {
    let polls = 0;
    const fetchImpl = fakeFetch((url) => {
      if (url.endsWith("/start")) {
        return jsonOk({ read_key: "rk", authorize_url: "https://x/", user_code: "BCDF-GHJK" });
      }
      if (url.includes("/poll")) {
        polls++;
        return jsonOk({ status: "pending" });
      }
      return notOk();
    });
    const cancel = new AbortController();

    // A long interval and timeout: the rejection must come from the abort, not from either.
    const pending = signIn(fetchImpl, {
      signal: cancel.signal,
      timeoutMs: 60_000,
      pollIntervalMs: 10_000,
      onUserCode: () => {
        // The user closes the code box as soon as it appears.
        setTimeout(() => {
          cancel.abort();
        }, 20);
      },
    });

    const startedAt = Date.now();
    await expect(pending).rejects.toBeInstanceOf(SignInCancelledError);
    expect(Date.now() - startedAt).toBeLessThan(2_000);
    expect(polls).toBe(0);
  });

  it("does not exchange the code when the cancel lands as the poll completes", async () => {
    const cancel = new AbortController();
    const calls: string[] = [];
    const fetchImpl: typeof fetch = (input) => {
      const url = urlOf(input);
      calls.push(url);
      if (url.endsWith("/start")) {
        return Promise.resolve(jsonOk({ read_key: "rk", authorize_url: "https://x/" }));
      }
      if (url.includes("/poll")) {
        // The relay releases the code, but the user cancelled while it was in flight.
        cancel.abort();
        return Promise.resolve(jsonOk({ status: "complete", code: "c" }));
      }
      return Promise.resolve(jsonOk({ access_token: "at" }));
    };

    await expect(signIn(fetchImpl, { signal: cancel.signal })).rejects.toBeInstanceOf(
      SignInCancelledError,
    );
    expect(calls.some((c) => c.endsWith("/exchange"))).toBe(false);
  });

  it("reports a cancel during the exchange, not a stored session", async () => {
    const cancel = new AbortController();
    const fetchImpl: typeof fetch = (input, init) => {
      const url = urlOf(input);
      if (url.endsWith("/start")) {
        return Promise.resolve(jsonOk({ read_key: "rk", authorize_url: "https://x/" }));
      }
      if (url.includes("/poll")) {
        return Promise.resolve(jsonOk({ status: "complete", code: "c" }));
      }
      // The exchange is in flight when the user cancels; the request is aborted.
      return new Promise((resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
        setTimeout(() => {
          cancel.abort();
        }, 10);
        setTimeout(() => {
          resolve(jsonOk({ access_token: "at" }));
        }, 100);
      });
    };

    await expect(signIn(fetchImpl, { signal: cancel.signal })).rejects.toBeInstanceOf(
      SignInCancelledError,
    );
  });

  it("does not start a flow when the signal is already aborted", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const cancel = new AbortController();
    cancel.abort();
    await expect(signIn(fetchImpl, { signal: cancel.signal })).rejects.toBeInstanceOf(
      SignInCancelledError,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
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
