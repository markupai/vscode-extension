import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as vscode from "vscode";
import { AuthManager, getJwtExpiry, promptForToken } from "../src/auth";

function makeJwt(payload: Record<string, unknown>): string {
  const encode = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  return `${encode({ alg: "RS256" })}.${encode(payload)}.signature`;
}

class FakeSecretStorage {
  private readonly values = new Map<string, string>();

  get(key: string): Promise<string | undefined> {
    return Promise.resolve(this.values.get(key));
  }

  store(key: string, value: string): Promise<void> {
    this.values.set(key, value);
    return Promise.resolve();
  }

  delete(key: string): Promise<void> {
    this.values.delete(key);
    return Promise.resolve();
  }
}

function createAuth(fetchImpl?: typeof fetch) {
  const secrets = new FakeSecretStorage();
  const auth = new AuthManager(
    secrets as unknown as vscode.SecretStorage,
    () => ({ baseUrl: "https://api.example.com", provider: "vscode-extension" }),
    fetchImpl ?? vi.fn(),
  );
  return { auth, secrets };
}

describe("getJwtExpiry", () => {
  it("extracts exp from a JWT as epoch milliseconds", () => {
    expect(getJwtExpiry(makeJwt({ exp: 1_700_000_000 }))).toBe(1_700_000_000_000);
  });

  it("returns undefined for non-JWT tokens (API keys)", () => {
    expect(getJwtExpiry("mat_abc123")).toBeUndefined();
  });

  it("returns undefined for JWTs without an exp claim", () => {
    expect(getJwtExpiry(makeJwt({ sub: "user" }))).toBeUndefined();
  });
});

/** How long a refused refresh waits for another window's write, plus slack. */
const SIBLING_WAIT_MS = 2_500;

const refused = () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });

describe("AuthManager", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stores and returns a session token", async () => {
    const { auth } = createAuth();

    await auth.setSession({ accessToken: "mat_key" });

    expect(await auth.isSignedIn()).toBe(true);
    expect(await auth.getValidToken()).toBe("mat_key");
  });

  it("rejects empty tokens", async () => {
    const { auth } = createAuth();
    await expect(auth.setSession({ accessToken: "   " })).rejects.toThrow("must not be empty");
  });

  it("signOut clears the session", async () => {
    const { auth } = createAuth();
    await auth.setSession({ accessToken: "mat_key" });

    await auth.signOut();

    expect(await auth.isSignedIn()).toBe(false);
    expect(await auth.getValidToken()).toBeUndefined();
  });

  it("fires onDidChange on sign-in and sign-out", async () => {
    const { auth } = createAuth();
    const listener = vi.fn();
    auth.onDidChange(listener);

    await auth.setSession({ accessToken: "tok" });
    await auth.signOut();

    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("returns unexpired tokens without refreshing", async () => {
    const fetchMock = vi.fn();
    const { auth } = createAuth(fetchMock);

    await auth.setSession({ accessToken: "tok", expiresIn: 3600 });

    expect(await auth.getValidToken()).toBe("tok");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refreshes an expired token using the refresh token", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ access_token: "fresh", expires_in: 3600, refresh_token: "rt2" }),
          { status: 200 },
        ),
      );
    const { auth } = createAuth(fetchMock);

    await auth.setSession({ accessToken: "stale", expiresIn: 1, refreshToken: "rt1" });

    const token = await auth.getValidToken();

    expect(token).toBe("fresh");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.example.com/oauth/vscode-extension/exchange");
    expect(JSON.parse(init.body as string)).toEqual({
      grant_type: "refresh_token",
      refresh_token: "rt1",
    });
    // New refresh token persisted for the next cycle.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await auth.getValidToken()).toBe("fresh");
  });

  it("signs out when the token is expired and no refresh token exists", async () => {
    const { auth } = createAuth();
    await auth.setSession({ accessToken: "stale", expiresIn: 1 });

    expect(await auth.getValidToken()).toBeUndefined();
    expect(await auth.isSignedIn()).toBe(false);
  });

  it("signs out when the relay refuses the refresh token", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(refused());
    const { auth } = createAuth(fetchMock);
    await auth.setSession({ accessToken: "stale", expiresIn: 1, refreshToken: "rt1" });

    const pending = auth.getValidToken();
    await vi.advanceTimersByTimeAsync(SIBLING_WAIT_MS);

    expect(await pending).toBeUndefined();
    expect(await auth.isSignedIn()).toBe(false);
  });

  it.each([500, 502, 503, 429, 408])(
    "keeps the session when the relay answers a refresh with %i",
    async (status) => {
      const fetchMock = vi.fn().mockResolvedValue(new Response("busy", { status }));
      const { auth, secrets } = createAuth(fetchMock);
      await auth.setSession({ accessToken: "stale", expiresIn: 1, refreshToken: "rt1" });

      expect(await auth.getValidToken()).toBeUndefined();
      expect(await auth.isSignedIn()).toBe(true);
      expect(await secrets.get("markupai-lint.refreshToken")).toBe("rt1");
    },
  );

  it("shares one in-flight refresh between concurrent callers", async () => {
    let resolveRefresh!: (response: Response) => void;
    const fetchMock = vi.fn().mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveRefresh = resolve;
      }),
    );
    const { auth } = createAuth(fetchMock);
    await auth.setSession({ accessToken: "stale", expiresIn: 1, refreshToken: "rt1" });

    const calls = [auth.getValidToken(), auth.getValidToken(), auth.getValidToken()];
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveRefresh(
      new Response(
        JSON.stringify({ access_token: "fresh", expires_in: 3600, refresh_token: "rt2" }),
        { status: 200 },
      ),
    );
    expect(await Promise.all(calls)).toEqual(["fresh", "fresh", "fresh"]);
  });

  it("adopts the session another window refreshed first instead of signing out", async () => {
    // Refresh tokens rotate. Two windows share one SecretStorage; the other window
    // presented rt1 first and stored rt2, so this window's rt1 is now a reuse.
    const fetchMock = vi.fn().mockImplementation(async () => {
      await secrets.store("markupai-lint.accessToken", "fresh-from-other-window");
      await secrets.store("markupai-lint.refreshToken", "rt2");
      return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
    });
    const { auth, secrets } = createAuth(fetchMock);
    await auth.setSession({ accessToken: "stale", expiresIn: 1, refreshToken: "rt1" });

    expect(await auth.getValidToken()).toBe("fresh-from-other-window");
    expect(await auth.isSignedIn()).toBe(true);
    expect(await secrets.get("markupai-lint.refreshToken")).toBe("rt2");
  });

  it("still signs out when the refused refresh token is the one in storage", async () => {
    // Nobody else rotated it: the token is genuinely revoked.
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(refused());
    const { auth, secrets } = createAuth(fetchMock);
    await auth.setSession({ accessToken: "stale", expiresIn: 1, refreshToken: "rt1" });

    const pending = auth.getValidToken();
    await vi.advanceTimersByTimeAsync(SIBLING_WAIT_MS);

    expect(await pending).toBeUndefined();
    expect(await auth.isSignedIn()).toBe(false);
    expect(await secrets.get("markupai-lint.refreshToken")).toBeUndefined();
  });

  it("waits for the other window's write to land before treating a refusal as revocation", async () => {
    // The usual ordering: this window's 400 arrives first, the winner's three
    // SecretStorage writes finish a moment later, refresh token last.
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(refused());
    const { auth, secrets } = createAuth(fetchMock);
    await auth.setSession({ accessToken: "stale", expiresIn: 1, refreshToken: "rt1" });

    const pending = auth.getValidToken();
    await vi.advanceTimersByTimeAsync(600);
    await secrets.store("markupai-lint.accessToken", "fresh-from-other-window");
    await secrets.store("markupai-lint.tokenExpiresAt", String(Date.now() + 3_600_000));
    await secrets.store("markupai-lint.refreshToken", "rt2");
    await vi.advanceTimersByTimeAsync(SIBLING_WAIT_MS);

    expect(await pending).toBe("fresh-from-other-window");
    expect(await auth.isSignedIn()).toBe(true);
    expect(await secrets.get("markupai-lint.refreshToken")).toBe("rt2");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not write its refresh result back after a sign-out during the round trip", async () => {
    const { auth, secrets } = createAuth(
      vi.fn().mockImplementation(async () => {
        // The user signed out (here or in another window) while /exchange was in flight.
        await auth.signOut();
        return new Response(
          JSON.stringify({ access_token: "fresh", expires_in: 3600, refresh_token: "rt2" }),
          { status: 200 },
        );
      }),
    );
    await auth.setSession({ accessToken: "stale", expiresIn: 1, refreshToken: "rt1" });

    expect(await auth.getValidToken()).toBeUndefined();
    expect(await auth.isSignedIn()).toBe(false);
    expect(await secrets.get("markupai-lint.refreshToken")).toBeUndefined();
  });

  it("adopts the other window's rotation instead of overwriting it with its own result", async () => {
    const { auth, secrets } = createAuth(
      vi.fn().mockImplementation(async () => {
        // Both windows presented rt1 and the relay answered both; the other
        // window's write landed first.
        await secrets.store("markupai-lint.accessToken", "fresh-from-other-window");
        await secrets.store("markupai-lint.refreshToken", "rt-other");
        return new Response(
          JSON.stringify({
            access_token: "fresh-mine",
            expires_in: 3600,
            refresh_token: "rt-mine",
          }),
          { status: 200 },
        );
      }),
    );
    await auth.setSession({ accessToken: "stale", expiresIn: 1, refreshToken: "rt1" });

    expect(await auth.getValidToken()).toBe("fresh-from-other-window");
    expect(await secrets.get("markupai-lint.refreshToken")).toBe("rt-other");
  });

  it("keeps the session on network errors during refresh", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const { auth } = createAuth(fetchMock);
    await auth.setSession({ accessToken: "stale", expiresIn: 1, refreshToken: "rt1" });

    expect(await auth.getValidToken()).toBeUndefined();
    expect(await auth.isSignedIn()).toBe(true);
  });

  it("derives expiry from the JWT exp claim when expires_in is missing", async () => {
    const fetchMock = vi.fn();
    const { auth } = createAuth(fetchMock);
    const expiredJwt = makeJwt({ exp: Math.floor(Date.now() / 1000) - 10 });

    await auth.setSession({ accessToken: expiredJwt });

    // Expired JWT without refresh token → signed out.
    expect(await auth.getValidToken()).toBeUndefined();
  });
});

describe("promptForToken", () => {
  it("stores the pasted token", async () => {
    const { auth } = createAuth();
    vi.mocked(vscode.window.showInputBox).mockResolvedValue("mat_pasted");

    const result = await promptForToken(auth);

    expect(result).toBe(true);
    expect(await auth.getValidToken()).toBe("mat_pasted");
  });

  it("returns false when the user cancels", async () => {
    const { auth } = createAuth();
    vi.mocked(vscode.window.showInputBox).mockResolvedValue(undefined);

    const result = await promptForToken(auth);

    expect(result).toBe(false);
    expect(await auth.isSignedIn()).toBe(false);
  });
});
