import * as vscode from "vscode";
import { USER_MESSAGE_PREFIX } from "./constants";

/**
 * Backend-mediated Auth0 sign-in — the same flow the sidebar-app uses for
 * iframe-embedded hosts, here against the "vscode-extension" provider:
 *
 *   1. POST {base}/oauth/{provider}/start → { read_key, authorize_url, user_code }
 *   2. Report user_code through `onUserCode` so the extension can show it: after
 *      signing in, the browser asks the user for that code and the relay releases
 *      the sign-in only when it matches. A relay without the confirmation step
 *      returns no code, and the flow then completes as it always did.
 *   3. Open authorize_url in the user's default browser
 *      (vscode.env.openExternal — works in both desktop and web hosts).
 *   4. Poll GET {base}/oauth/{provider}/poll?read_key=… every 2 s, for up to
 *      five minutes (the relay's state TTL — it forgets the flow after that).
 *        { status: "pending" }   → keep polling
 *        { status: "error", error } → abort
 *        { status: "complete", code } → proceed
 *        HTTP 400 → abort: the read key is invalid or expired, nothing can follow
 *        anything else (dropped request, 5xx, non-JSON body) → keep polling
 *   5. POST {base}/oauth/{provider}/exchange with
 *      { grant_type: "authorization_code", code } → { access_token, … }
 *
 * Every request carries the caller's abort signal and a per-request timeout,
 * so a cancel takes effect at once and a stalled request cannot outlive the
 * five-minute deadline.
 *
 * No localhost server, no sidebar-app involvement — purely a VS Code-to-
 * API conversation, identical to what sidebar-app does for its own provider.
 */

/** Thrown when the caller aborts the flow through {@link BrowserSignInOptions.signal}. */
export class SignInCancelledError extends Error {
  constructor() {
    super(`${USER_MESSAGE_PREFIX}sign-in cancelled.`);
    this.name = "SignInCancelledError";
  }
}

/** Shown when the relay no longer holds the flow: the user took too long, or never finished in the browser. */
export const SIGN_IN_EXPIRED_MESSAGE = `${USER_MESSAGE_PREFIX}sign-in expired. Please try again.`;

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
  /** How long any single relay request may take before it is abandoned and retried. */
  readonly requestTimeoutMs?: number;
  /**
   * Receives the relay's confirmation code once `/start` returns one, before
   * the browser opens. Not called when the relay returns none.
   */
  readonly onUserCode?: (code: string) => void;
  /** Aborting it ends the wait at once with a {@link SignInCancelledError}. */
  readonly signal?: AbortSignal;
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
  readonly userCode?: unknown;
  readonly user_code?: unknown;
}

interface PollResponse {
  readonly status?: string;
  readonly code?: string | null;
  readonly error?: unknown;
}

interface ExchangeResponse {
  readonly access_token?: string;
  readonly accessToken?: string;
  readonly expires_in?: number;
  readonly expiresIn?: number;
  readonly refresh_token?: string;
  readonly refreshToken?: string;
}

/**
 * Matches the relay's state TTL. The wait has to cover the Auth0 login, the
 * organization picker, and reading and typing the confirmation code; waiting
 * longer than the relay keeps the flow would gain nothing.
 */
export const DEFAULT_TIMEOUT_MS = 300_000;
const DEFAULT_POLL_INTERVAL_MS = 2_000;
/** A relay request that takes longer than this is abandoned; the loop then retries. */
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
/** How much of the relay's own error text is kept in the log. */
const RELAY_ERROR_LOG_LIMIT = 200;

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
  const requestTimeoutMs = opts.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const relay: Relay = {
    fetchImpl,
    base: stripTrailingSlash(opts.apiBaseUrl),
    provider: encodeURIComponent(opts.provider),
    signal: opts.signal,
    requestTimeoutMs,
  };

  throwIfCancelled(opts.signal);
  const { readKey, authorizeUrl, userCode } = await startMediation(relay);
  if (userCode) {
    opts.onUserCode?.(userCode);
  }

  const opened = await openExternal(vscode.Uri.parse(authorizeUrl));
  if (!opened) {
    throw new Error(`${USER_MESSAGE_PREFIX}could not open the browser. Sign in manually.`);
  }

  const code = await pollForCode(relay, readKey, { timeoutMs, pollIntervalMs });
  // A cancel that lands while the relay was releasing the code must not turn
  // into a stored session; nor one that lands during the exchange itself.
  throwIfCancelled(opts.signal);
  const result = await exchangeCode(relay, code);
  throwIfCancelled(opts.signal);
  return result;
}

interface Relay {
  readonly fetchImpl: typeof fetch;
  readonly base: string;
  readonly provider: string;
  readonly signal: AbortSignal | undefined;
  readonly requestTimeoutMs: number;
}

function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new SignInCancelledError();
  }
}

/**
 * A signal for one relay request: aborts when the caller cancels, or when
 * the request has taken longer than the per-request timeout.
 */
function requestSignal(relay: Relay): AbortSignal {
  const timeout = AbortSignal.timeout(relay.requestTimeoutMs);
  return relay.signal ? AbortSignal.any([relay.signal, timeout]) : timeout;
}

async function startMediation(
  relay: Relay,
): Promise<{ readKey: string; authorizeUrl: string; userCode?: string }> {
  const res = await relay.fetchImpl(`${relay.base}/oauth/${relay.provider}/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    signal: requestSignal(relay),
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
  const userCode = readUserCode(data);
  return { readKey, authorizeUrl, ...(userCode ? { userCode } : {}) };
}

/**
 * The relay's confirmation code, when the start response carries a usable
 * one. Both spellings are checked and only a non-empty string counts: an
 * empty `userCode` must not mask a valid `user_code`, and a non-string value
 * must never reach the code box.
 */
function readUserCode(data: StartResponse): string | undefined {
  for (const candidate of [data.userCode, data.user_code]) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return undefined;
}

async function pollForCode(
  relay: Relay,
  readKey: string,
  opts: { timeoutMs: number; pollIntervalMs: number },
): Promise<string> {
  const url = new URL(`${relay.base}/oauth/${relay.provider}/poll`);
  url.searchParams.set("read_key", readKey);
  const deadline = Date.now() + opts.timeoutMs;
  while (Date.now() < deadline) {
    await delay(opts.pollIntervalMs, relay.signal);
    throwIfCancelled(relay.signal);
    const outcome = await pollOnce(relay, url.toString());
    if (outcome !== "retry") {
      return outcome.code;
    }
  }
  throw new Error(`${USER_MESSAGE_PREFIX}browser sign-in timed out. Please try again.`);
}

/**
 * One poll of the relay. Resolves with the authorization code once the user
 * has confirmed, `"retry"` while the flow is still pending or the request
 * failed transiently, and throws when the flow can no longer complete.
 */
async function pollOnce(relay: Relay, url: string): Promise<{ code: string } | "retry"> {
  let res: Response;
  try {
    res = await relay.fetchImpl(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: requestSignal(relay),
    });
  } catch {
    // A dropped connection or a request past its timeout: the relay still
    // holds the flow, so keep waiting. A cancel surfaces on the next check.
    throwIfCancelled(relay.signal);
    return "retry";
  }
  if (res.status === 400) {
    // The relay refuses the read key: invalid, or past its TTL. Nothing can
    // complete this flow any more, so surface it now rather than at the
    // deadline. The relay's own wording stays out of the toast.
    const refused = await readPollError(res);
    if (refused) {
      console.debug(`${USER_MESSAGE_PREFIX}relay refused the poll: ${refused}`);
    }
    throw new Error(SIGN_IN_EXPIRED_MESSAGE);
  }
  if (!res.ok) {
    return "retry";
  }
  let data: PollResponse;
  try {
    data = (await res.json()) as PollResponse;
  } catch {
    // A proxy page or a truncated body on a 200: transient, keep waiting.
    return "retry";
  }
  if (data.status === "error") {
    const detail = relayErrorText(data.error);
    throw new Error(`${USER_MESSAGE_PREFIX}${detail ?? "OAuth mediation returned error."}`);
  }
  if (data.status === "complete" && data.code) {
    return { code: data.code };
  }
  return "retry";
}

async function exchangeCode(relay: Relay, code: string): Promise<BrowserSignInResult> {
  let res: Response;
  try {
    res = await relay.fetchImpl(`${relay.base}/oauth/${relay.provider}/exchange`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ grant_type: "authorization_code", code }),
      signal: requestSignal(relay),
    });
  } catch {
    throwIfCancelled(relay.signal);
    throw new Error(`${USER_MESSAGE_PREFIX}OAuth token exchange failed (network).`);
  }
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

/** Resolves after `ms`, or at once when `signal` aborts, so a cancel need not wait out a poll interval. */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** The relay's `error` field from a poll body, when it is a non-empty string; otherwise undefined. */
async function readPollError(res: Response): Promise<string | undefined> {
  try {
    const data = (await res.json()) as PollResponse;
    return relayErrorText(data.error);
  } catch {
    return undefined;
  }
}

/** Only a non-empty string is relay error text, and only so much of it is kept. */
function relayErrorText(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }
  return value.trim().slice(0, RELAY_ERROR_LOG_LIMIT);
}

/** Remove any trailing `/` chars. Linear, no regex backtracking. */
function stripTrailingSlash(s: string): string {
  let end = s.length;
  while (end > 0 && s[end - 1] === "/") end--;
  return s.slice(0, end);
}
