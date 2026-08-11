import * as vscode from "vscode";
import { AuthManager } from "./auth";

export const AUTH_PROVIDER_ID = "markupai";
export const AUTH_PROVIDER_LABEL = "Markup AI";

/**
 * Canonical scopes for every session and getSession call. Must be non-empty
 * and identical everywhere: VS Code keys its Accounts-menu "Sign in with …"
 * requests by `scopes.join(" ")` and clears them by comparing that key
 * (split back on " ") against added sessions' scopes. With empty scopes the
 * key round-trips as [""], which never matches a session's [] — leaving the
 * request entry and number badge stuck after sign-in.
 */
export const SESSION_SCOPES = ["markupai"] as const;

/** Single-account provider — one stable session id per signed-in state. */
const SESSION_ID = "markupai.session";

interface JwtIdentityClaims {
  email?: string;
  name?: string;
  sub?: string;
}

/**
 * Bridges the existing AuthManager session to the VS Code Authentication
 * API so the Markup AI account shows up in the Accounts menu (with sign-out)
 * and other extensions can request a session via
 * `vscode.authentication.getSession("markupai", …)`.
 *
 * The interactive flow itself is delegated back to the extension's sign-in
 * command (browser-mediated OAuth or pasted token), so both entry points
 * share one token store.
 */
export class MarkupAIAuthenticationProvider
  implements vscode.AuthenticationProvider, vscode.Disposable
{
  private readonly changed =
    new vscode.EventEmitter<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>();
  readonly onDidChangeSessions = this.changed.event;

  private lastSession: vscode.AuthenticationSession | undefined;
  /** Tokens already reported to VS Code in an `added` event. */
  private readonly announcedTokens = new Set<string>();
  private pendingEmit: Promise<void> = Promise.resolve();
  private readonly authListener: vscode.Disposable;

  constructor(
    private readonly auth: AuthManager,
    private readonly performInteractiveSignIn: () => Promise<boolean>,
  ) {
    this.authListener = auth.onDidChange(() => {
      void this.emitSessionChange();
    });
  }

  async getSessions(): Promise<vscode.AuthenticationSession[]> {
    const session = await this.currentSession();
    this.lastSession = session;
    return session ? [session] : [];
  }

  async createSession(): Promise<vscode.AuthenticationSession> {
    // A token may already exist (sign-in from a version before the
    // Accounts-menu integration, or the user clicking the Accounts-menu
    // request while signed in) — hand VS Code the existing session instead
    // of rerunning the interactive flow.
    let session = await this.currentSession();
    if (!session) {
      const signedIn = await this.performInteractiveSignIn();
      session = signedIn ? await this.currentSession() : undefined;
    }
    if (!session) {
      throw new Error("Markup AI sign-in was not completed.");
    }
    await this.emitSessionChange();
    // VS Code clears its "Sign in with Markup AI…" Accounts-menu request
    // only when it sees the session in an added event. Make sure this
    // session was announced even when the reconcile saw no state change
    // (session existed before this createSession call).
    if (!this.announcedTokens.has(session.accessToken)) {
      this.lastSession = session;
      this.announcedTokens.add(session.accessToken);
      this.changed.fire({ added: [session], removed: [], changed: [] });
    }
    return session;
  }

  async removeSession(_sessionId: string): Promise<void> {
    await this.auth.signOut();
    await this.emitSessionChange();
  }

  dispose(): void {
    this.authListener.dispose();
    this.changed.dispose();
  }

  private async currentSession(): Promise<vscode.AuthenticationSession | undefined> {
    const token = await this.auth.getValidToken();
    if (!token) {
      return undefined;
    }
    return {
      id: SESSION_ID,
      accessToken: token,
      account: { id: AUTH_PROVIDER_ID, label: accountLabelFromToken(token) },
      scopes: SESSION_SCOPES,
    };
  }

  /**
   * Reconciles the auth store against the last state reported to VS Code and
   * fires onDidChangeSessions for the difference. Both the AuthManager change
   * listener and createSession/removeSession funnel through here; runs are
   * serialized so a change event arriving mid-createSession (AuthManager
   * fires before the interactive flow returns) cannot double-report.
   */
  private emitSessionChange(): Promise<void> {
    this.pendingEmit = this.pendingEmit.then(() => this.reconcileSessions());
    return this.pendingEmit;
  }

  private async reconcileSessions(): Promise<void> {
    const previous = this.lastSession;
    const current = await this.currentSession();
    if (previous?.accessToken === current?.accessToken) {
      return;
    }
    this.lastSession = current;

    if (current && !previous) {
      this.announcedTokens.add(current.accessToken);
      this.changed.fire({ added: [current], removed: [], changed: [] });
    } else if (!current && previous) {
      this.changed.fire({ added: [], removed: [previous], changed: [] });
    } else if (current && previous) {
      this.announcedTokens.add(current.accessToken);
      this.changed.fire({ added: [], removed: [], changed: [current] });
    }
  }
}

/** Best-effort display name from a JWT; API keys get a generic label. */
export function accountLabelFromToken(token: string): string {
  const claims = getJwtIdentityClaims(token);
  return claims?.email ?? claims?.name ?? claims?.sub ?? "Markup AI account";
}

function getJwtIdentityClaims(token: string): JwtIdentityClaims | undefined {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return undefined;
  }
  try {
    return JSON.parse(decodeBase64Url(parts[1])) as JwtIdentityClaims;
  } catch {
    return undefined;
  }
}

function decodeBase64Url(value: string): string {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  return atob(padded);
}
