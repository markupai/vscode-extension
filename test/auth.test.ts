import { describe, it, expect, vi, beforeEach } from "vitest";
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

describe("AuthManager", () => {
  beforeEach(() => {
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

  it("signs out when the refresh request is rejected", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }));
    const { auth } = createAuth(fetchMock);
    await auth.setSession({ accessToken: "stale", expiresIn: 1, refreshToken: "rt1" });

    expect(await auth.getValidToken()).toBeUndefined();
    expect(await auth.isSignedIn()).toBe(false);
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
