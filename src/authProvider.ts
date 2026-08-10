import * as vscode from "vscode";
import { AuthManager } from "./auth";

export const AUTH_PROVIDER_ID = "markupai";
export const AUTH_PROVIDER_LABEL = "Markup AI";

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
    return session ? [session] : [];
  }

  async createSession(): Promise<vscode.AuthenticationSession> {
    const signedIn = await this.performInteractiveSignIn();
    const session = signedIn ? await this.currentSession() : undefined;
    if (!session) {
      throw new Error("Markup AI sign-in was not completed.");
    }
    return session;
  }

  async removeSession(_sessionId: string): Promise<void> {
    await this.auth.signOut();
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
      scopes: [],
    };
  }

  private async emitSessionChange(): Promise<void> {
    const previous = this.lastSession;
    const current = await this.currentSession();
    this.lastSession = current;

    if (current && !previous) {
      this.changed.fire({ added: [current], removed: [], changed: [] });
    } else if (!current && previous) {
      this.changed.fire({ added: [], removed: [previous], changed: [] });
    } else if (current && previous) {
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
