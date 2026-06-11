import * as vscode from "vscode";
import { USER_MESSAGE_PREFIX } from "./constants";

const ACCESS_TOKEN_KEY = "markupai.accessToken";
const REFRESH_TOKEN_KEY = "markupai.refreshToken";
const EXPIRES_AT_KEY = "markupai.tokenExpiresAt";

/** Refresh this long before the access token actually expires. */
const EXPIRY_BUFFER_MS = 60_000;

export interface SessionTokens {
  accessToken: string;
  /** Lifetime in seconds, from the OAuth exchange response. */
  expiresIn?: number;
  refreshToken?: string;
}

interface RefreshResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
}

export interface OAuthEndpoint {
  baseUrl: string;
  provider: string;
}

/**
 * Session storage and lifecycle for the mediated Auth0 sign-in.
 *
 * Tokens live in VS Code `SecretStorage`. `getValidToken()` is the single
 * entry point for API callers: it returns the stored access token,
 * transparently refreshing it via `POST /oauth/{provider}/exchange`
 * (grant_type=refresh_token) when it is about to expire. Pasted API keys
 * (`mat_…`) carry no expiry and are returned as-is.
 */
export class AuthManager implements vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;
  private refreshInFlight: Promise<string | undefined> | null = null;

  constructor(
    private readonly secrets: vscode.SecretStorage,
    private readonly getOAuthEndpoint: () => OAuthEndpoint,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async setSession(tokens: SessionTokens): Promise<void> {
    const accessToken = tokens.accessToken.trim();
    if (!accessToken) {
      throw new Error(`${USER_MESSAGE_PREFIX}token must not be empty.`);
    }

    await this.secrets.store(ACCESS_TOKEN_KEY, accessToken);

    const expiresAt = resolveExpiry(accessToken, tokens.expiresIn);
    if (expiresAt) {
      await this.secrets.store(EXPIRES_AT_KEY, String(expiresAt));
    } else {
      await this.secrets.delete(EXPIRES_AT_KEY);
    }

    if (tokens.refreshToken) {
      await this.secrets.store(REFRESH_TOKEN_KEY, tokens.refreshToken);
    } else {
      await this.secrets.delete(REFRESH_TOKEN_KEY);
    }

    this.changed.fire();
  }

  async signOut(): Promise<void> {
    await this.secrets.delete(ACCESS_TOKEN_KEY);
    await this.secrets.delete(REFRESH_TOKEN_KEY);
    await this.secrets.delete(EXPIRES_AT_KEY);
    this.changed.fire();
  }

  async isSignedIn(): Promise<boolean> {
    const token = await this.secrets.get(ACCESS_TOKEN_KEY);
    return Boolean(token && token.trim().length > 0);
  }

  /**
   * Returns an access token that is good for at least EXPIRY_BUFFER_MS,
   * refreshing if needed. Returns undefined when signed out or when the
   * session can no longer be refreshed.
   */
  async getValidToken(): Promise<string | undefined> {
    const accessToken = await this.secrets.get(ACCESS_TOKEN_KEY);
    if (!accessToken) {
      return undefined;
    }

    const expiresAtRaw = await this.secrets.get(EXPIRES_AT_KEY);
    const expiresAt = expiresAtRaw ? Number(expiresAtRaw) : undefined;
    if (!expiresAt || Number.isNaN(expiresAt) || Date.now() < expiresAt - EXPIRY_BUFFER_MS) {
      return accessToken;
    }

    this.refreshInFlight ??= this.refresh().finally(() => {
      this.refreshInFlight = null;
    });
    return this.refreshInFlight;
  }

  private async refresh(): Promise<string | undefined> {
    const refreshToken = await this.secrets.get(REFRESH_TOKEN_KEY);
    if (!refreshToken) {
      await this.signOut();
      return undefined;
    }

    const { baseUrl, provider } = this.getOAuthEndpoint();
    let response: Response;
    try {
      response = await this.fetchImpl(`${baseUrl}/oauth/${encodeURIComponent(provider)}/exchange`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ grant_type: "refresh_token", refresh_token: refreshToken }),
      });
    } catch {
      // Network failure — keep the session so a later call can retry.
      return undefined;
    }

    if (!response.ok) {
      await this.signOut();
      return undefined;
    }

    const data = (await response.json()) as RefreshResponse;
    if (!data.access_token) {
      await this.signOut();
      return undefined;
    }

    await this.setSession({
      accessToken: data.access_token,
      expiresIn: data.expires_in,
      refreshToken: data.refresh_token ?? refreshToken,
    });
    return data.access_token;
  }

  dispose(): void {
    this.changed.dispose();
  }
}

/**
 * Fallback sign-in for hosts where the browser-mediated flow is not
 * available, and for API-key based use (CI, testing): the user pastes a
 * JWT or a `mat_…` API key.
 */
export async function promptForToken(auth: AuthManager): Promise<boolean> {
  const token = await vscode.window.showInputBox({
    title: "MarkupAI Sign In",
    prompt: "Paste your MarkupAI access token (JWT) or API key.",
    placeHolder: "eyJ… or mat_…",
    password: true,
    ignoreFocusOut: true,
    validateInput: (v) => (v.trim() ? null : "Token must not be empty."),
  });
  if (!token) {
    return false;
  }
  await auth.setSession({ accessToken: token });
  return true;
}

function resolveExpiry(accessToken: string, expiresIn?: number): number | undefined {
  if (typeof expiresIn === "number" && expiresIn > 0) {
    return Date.now() + expiresIn * 1000;
  }
  return getJwtExpiry(accessToken);
}

/** Epoch-ms expiry from a JWT `exp` claim; undefined for non-JWT tokens. */
export function getJwtExpiry(token: string): number | undefined {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return undefined;
  }
  try {
    const payload = JSON.parse(decodeBase64Url(parts[1])) as { exp?: number };
    return typeof payload.exp === "number" ? payload.exp * 1000 : undefined;
  } catch {
    return undefined;
  }
}

function decodeBase64Url(value: string): string {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  return atob(padded);
}
