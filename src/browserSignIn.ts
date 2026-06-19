import * as vscode from "vscode";
import { USER_MESSAGE_PREFIX } from "./constants";

/**
 * Backend-mediated Auth0 sign-in — the same flow the sidebar-app uses for
 * iframe-embedded hosts, here against the "vscode-extension" provider:
 *
 *   1. POST {base}/oauth/{provider}/start → { read_key, authorize_url }
 *   2. Open authorize_url in the user's default browser
 *      (vscode.env.openExternal — works in both desktop and web hosts).
 *   3. Poll GET {base}/oauth/{provider}/poll?read_key=… every 2 s.
 *        { status: "pending" }   → keep polling
 *        { status: "error", error } → abort
 *        { status: "complete", code } → proceed
 *   4. POST {base}/oauth/{provider}/exchange with
 *      { grant_type: "authorization_code", code } → { access_token, … }
 *
 * No localhost server, no sidebar-app involvement — purely a VS Code-to-
 * API conversation, identical to what sidebar-app does for its own provider.
 */

export interface BrowserSignInResult {
  readonly accessToken: string;
  readonly expiresIn?: number;
  readonly refreshToken?: string;
}

export interface BrowserSignInOptions {
  readonly apiBaseUrl: string;
  readonly provider: string;
  readonly timeoutMs?: number;
  readonly pollIntervalMs?: number;
  /** Exposed for tests — defaults to the platform `fetch`. */
  readonly fetchImpl?: typeof fetch;
  /** Exposed for tests — defaults to `vscode.env.openExternal`. */
  readonly openExternal?: (uri: vscode.Uri) => Thenable<boolean>;
}

interface StartResponse {
  readonly readKey?: string;
  readonly read_key?: string;
  readonly authorizeUrl?: string;
  readonly authorize_url?: string;
}

interface PollResponse {
  readonly status?: string;
  readonly code?: string | null;
  readonly error?: string | null;
}

interface ExchangeResponse {
  readonly access_token?: string;
  readonly accessToken?: string;
  readonly expires_in?: number;
  readonly expiresIn?: number;
  readonly refresh_token?: string;
  readonly refreshToken?: string;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_POLL_INTERVAL_MS = 2_000;

/**
 * The flow only needs `fetch` + `vscode.env.openExternal`, both of which
 * are available on every extension host. Kept as a helper in case a
 * future host lacks one.
 */
export function isBrowserSignInAvailable(): boolean {
  return typeof fetch === "function" && typeof vscode.env.openExternal === "function";
}

export async function runBrowserSignIn(opts: BrowserSignInOptions): Promise<BrowserSignInResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const openExternal = opts.openExternal ?? ((uri) => vscode.env.openExternal(uri));
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

  const base = stripTrailingSlash(opts.apiBaseUrl);
  const provider = encodeURIComponent(opts.provider);

  const { readKey, authorizeUrl } = await startMediation(fetchImpl, base, provider);

  const opened = await openExternal(vscode.Uri.parse(authorizeUrl));
  if (!opened) {
    throw new Error(`${USER_MESSAGE_PREFIX}could not open the browser. Sign in manually.`);
  }

  const code = await pollForCode(fetchImpl, base, provider, readKey, {
    timeoutMs,
    pollIntervalMs,
  });
  return exchangeCode(fetchImpl, base, provider, code);
}

async function startMediation(
  fetchImpl: typeof fetch,
  base: string,
  provider: string,
): Promise<{ readKey: string; authorizeUrl: string }> {
  const res = await fetchImpl(`${base}/oauth/${provider}/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`${USER_MESSAGE_PREFIX}failed to start OAuth flow (${String(res.status)}).`);
  }
  const data = (await res.json()) as StartResponse;
  const readKey = data.readKey ?? data.read_key;
  const authorizeUrl = data.authorizeUrl ?? data.authorize_url;
  if (!readKey || !authorizeUrl) {
    throw new Error(`${USER_MESSAGE_PREFIX}OAuth start response missing keys.`);
  }
  return { readKey, authorizeUrl };
}

async function pollForCode(
  fetchImpl: typeof fetch,
  base: string,
  provider: string,
  readKey: string,
  opts: { timeoutMs: number; pollIntervalMs: number },
): Promise<string> {
  const deadline = Date.now() + opts.timeoutMs;
  while (Date.now() < deadline) {
    await delay(opts.pollIntervalMs);
    const url = new URL(`${base}/oauth/${provider}/poll`);
    url.searchParams.set("read_key", readKey);
    let res: Response;
    try {
      res = await fetchImpl(url.toString(), {
        method: "GET",
        headers: { Accept: "application/json" },
      });
    } catch {
      continue;
    }
    if (!res.ok) continue;
    const data = (await res.json()) as PollResponse;
    if (data.status === "pending") continue;
    if (data.status === "error") {
      throw new Error(`${USER_MESSAGE_PREFIX}${data.error ?? "OAuth mediation returned error."}`);
    }
    if (data.status === "complete" && data.code) {
      return data.code;
    }
  }
  throw new Error(`${USER_MESSAGE_PREFIX}browser sign-in timed out. Please try again.`);
}

async function exchangeCode(
  fetchImpl: typeof fetch,
  base: string,
  provider: string,
  code: string,
): Promise<BrowserSignInResult> {
  const res = await fetchImpl(`${base}/oauth/${provider}/exchange`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ grant_type: "authorization_code", code }),
  });
  if (!res.ok) {
    throw new Error(`${USER_MESSAGE_PREFIX}OAuth token exchange failed (${String(res.status)}).`);
  }
  const data = (await res.json()) as ExchangeResponse;
  const accessToken = data.accessToken ?? data.access_token;
  if (!accessToken) {
    throw new Error(`${USER_MESSAGE_PREFIX}OAuth exchange missing access token.`);
  }
  const expiresIn = data.expiresIn ?? data.expires_in;
  const refreshToken = data.refreshToken ?? data.refresh_token;
  return {
    accessToken,
    ...(typeof expiresIn === "number" && expiresIn > 0 ? { expiresIn } : {}),
    ...(typeof refreshToken === "string" && refreshToken ? { refreshToken } : {}),
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Remove any trailing `/` chars. Linear, no regex backtracking. */
function stripTrailingSlash(s: string): string {
  let end = s.length;
  while (end > 0 && s[end - 1] === "/") end--;
  return s.slice(0, end);
}
