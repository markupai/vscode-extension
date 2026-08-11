import { describe, it, expect, vi } from "vitest";
import * as vscode from "vscode";
import { AuthManager } from "../src/auth";
import {
  accountLabelFromToken,
  AUTH_PROVIDER_ID,
  MarkupAIAuthenticationProvider,
} from "../src/authProvider";

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

function createAuth() {
  return new AuthManager(
    new FakeSecretStorage() as unknown as vscode.SecretStorage,
    () => ({ baseUrl: "https://api.example.com", provider: "vscode-extension" }),
    vi.fn(),
  );
}

describe("accountLabelFromToken", () => {
  it("prefers the email claim", () => {
    expect(accountLabelFromToken(makeJwt({ email: "user@markup.ai", name: "User" }))).toBe(
      "user@markup.ai",
    );
  });

  it("falls back to name, then sub", () => {
    expect(accountLabelFromToken(makeJwt({ name: "User" }))).toBe("User");
    expect(accountLabelFromToken(makeJwt({ sub: "auth0|123" }))).toBe("auth0|123");
  });

  it("uses a generic label for API keys", () => {
    expect(accountLabelFromToken("mat_abc123")).toBe("Markup AI account");
  });
});

describe("MarkupAIAuthenticationProvider", () => {
  it("returns no sessions when signed out", async () => {
    const provider = new MarkupAIAuthenticationProvider(createAuth(), vi.fn());
    expect(await provider.getSessions()).toEqual([]);
  });

  it("returns one session with account details when signed in", async () => {
    const auth = createAuth();
    await auth.setSession({ accessToken: makeJwt({ email: "user@markup.ai" }) });

    const provider = new MarkupAIAuthenticationProvider(auth, vi.fn());
    const sessions = await provider.getSessions();

    expect(sessions).toHaveLength(1);
    expect(sessions[0].account).toEqual({ id: AUTH_PROVIDER_ID, label: "user@markup.ai" });
    expect(sessions[0].accessToken).toBe(makeJwt({ email: "user@markup.ai" }));
  });

  it("createSession delegates to the interactive sign-in and returns the session", async () => {
    const auth = createAuth();
    const performSignIn = vi.fn(async () => {
      await auth.setSession({ accessToken: "mat_key" });
      return true;
    });

    const provider = new MarkupAIAuthenticationProvider(auth, performSignIn);
    const session = await provider.createSession();

    expect(performSignIn).toHaveBeenCalledOnce();
    expect(session.accessToken).toBe("mat_key");
  });

  it("createSession returns the existing session without rerunning sign-in when already signed in", async () => {
    const auth = createAuth();
    await auth.setSession({ accessToken: "mat_key" });

    const performSignIn = vi.fn(() => Promise.resolve(true));
    const provider = new MarkupAIAuthenticationProvider(auth, performSignIn);
    await provider.getSessions();

    const events: vscode.AuthenticationProviderAuthenticationSessionsChangeEvent[] = [];
    provider.onDidChangeSessions((e) => events.push(e));

    const session = await provider.createSession();

    expect(performSignIn).not.toHaveBeenCalled();
    expect(session.accessToken).toBe("mat_key");
    // The session predates createSession, so it must still be announced as
    // added — VS Code uses that event to clear its Accounts-menu request.
    expect(events).toHaveLength(1);
    expect(events[0].added).toHaveLength(1);
  });

  it("createSession throws when the interactive sign-in is cancelled", async () => {
    const provider = new MarkupAIAuthenticationProvider(
      createAuth(),
      vi.fn(() => Promise.resolve(false)),
    );
    await expect(provider.createSession()).rejects.toThrow("sign-in was not completed");
  });

  it("removeSession signs the user out", async () => {
    const auth = createAuth();
    await auth.setSession({ accessToken: "mat_key" });

    const provider = new MarkupAIAuthenticationProvider(auth, vi.fn());
    const sessions = await provider.getSessions();
    await provider.removeSession(sessions[0].id);

    expect(await auth.isSignedIn()).toBe(false);
  });

  it("fires a removed event on sign-out when the session predates the provider", async () => {
    // Activation while already signed in: getSessions seeds the provider's
    // last-known session so a later sign-out still reports the removal.
    const auth = createAuth();
    await auth.setSession({ accessToken: "mat_key" });

    const provider = new MarkupAIAuthenticationProvider(auth, vi.fn());
    await provider.getSessions();

    const events: vscode.AuthenticationProviderAuthenticationSessionsChangeEvent[] = [];
    provider.onDidChangeSessions((e) => events.push(e));

    await auth.signOut();
    await vi.waitFor(() => {
      expect(events).toHaveLength(1);
    });
    expect(events[0].removed).toHaveLength(1);
  });

  it("removeSession fires a removed event", async () => {
    const auth = createAuth();
    await auth.setSession({ accessToken: "mat_key" });

    const provider = new MarkupAIAuthenticationProvider(auth, vi.fn());
    const sessions = await provider.getSessions();

    const events: vscode.AuthenticationProviderAuthenticationSessionsChangeEvent[] = [];
    provider.onDidChangeSessions((e) => events.push(e));

    await provider.removeSession(sessions[0].id);
    await vi.waitFor(() => {
      expect(events).toHaveLength(1);
    });
    expect(events[0].removed).toHaveLength(1);
    expect(events[0].added).toHaveLength(0);
  });

  it("does not fire duplicate added events when createSession drives the sign-in", async () => {
    const auth = createAuth();
    const performSignIn = vi.fn(async () => {
      await auth.setSession({ accessToken: "mat_key" });
      return true;
    });
    const provider = new MarkupAIAuthenticationProvider(auth, performSignIn);

    const events: vscode.AuthenticationProviderAuthenticationSessionsChangeEvent[] = [];
    provider.onDidChangeSessions((e) => events.push(e));

    await provider.createSession();
    // Let the AuthManager change listener's queued reconcile settle too.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(events).toHaveLength(1);
    expect(events[0].added).toHaveLength(1);
  });

  it("fires onDidChangeSessions with added/removed on sign-in and sign-out", async () => {
    const auth = createAuth();
    const provider = new MarkupAIAuthenticationProvider(auth, vi.fn());

    const events: vscode.AuthenticationProviderAuthenticationSessionsChangeEvent[] = [];
    provider.onDidChangeSessions((e) => events.push(e));

    await auth.setSession({ accessToken: "mat_key" });
    await vi.waitFor(() => {
      expect(events).toHaveLength(1);
    });
    expect(events[0].added).toHaveLength(1);
    expect(events[0].removed).toHaveLength(0);

    await auth.signOut();
    await vi.waitFor(() => {
      expect(events).toHaveLength(2);
    });
    expect(events[1].added).toHaveLength(0);
    expect(events[1].removed).toHaveLength(1);
  });
});
