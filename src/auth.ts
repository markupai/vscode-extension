import * as vscode from "vscode";
import { USER_MESSAGE_PREFIX } from "./constants.js";

const TOKEN_KEY = "markupai.authToken";

/**
 * Single-credential auth: an Auth0 access token (JWT) stored in VS Code
 * `SecretStorage` and sent as `Authorization: Bearer <token>` on every
 * API request — including `/internal/*` endpoints like `/internal/targets`.
 *
 * Tokens are obtained via the browser-mediated sign-in flow
 * (`MarkupAI: Sign In`); web-host VS Code falls back to a paste prompt
 * because local callback servers aren't available there.
 */
export class AuthStore {
  private readonly changed = new vscode.EventEmitter<string | undefined>();
  readonly onDidChange = this.changed.event;

  constructor(private readonly secrets: vscode.SecretStorage) {}

  async getToken(): Promise<string | undefined> {
    return this.secrets.get(TOKEN_KEY);
  }

  async hasToken(): Promise<boolean> {
    const token = await this.getToken();
    return Boolean(token && token.trim().length > 0);
  }

  async setToken(token: string): Promise<void> {
    const trimmed = token.trim();
    if (!trimmed) {
      throw new Error(`${USER_MESSAGE_PREFIX}token must not be empty.`);
    }
    await this.secrets.store(TOKEN_KEY, trimmed);
    this.changed.fire(trimmed);
  }

  async clearToken(): Promise<void> {
    await this.secrets.delete(TOKEN_KEY);
    this.changed.fire(undefined);
  }

  dispose(): void {
    this.changed.dispose();
  }
}

/**
 * Fallback sign-in for hosts where the browser-mediated flow isn't
 * available (vscode.dev / github.dev / Codespaces web). The user pastes
 * a JWT they obtained elsewhere (e.g. from the sidebar-app after a
 * normal sign-in).
 */
export async function promptForToken(auth: AuthStore): Promise<boolean> {
  const token = await vscode.window.showInputBox({
    title: "MarkupAI Sign In",
    prompt: "Paste your MarkupAI access token (JWT).",
    placeHolder: "eyJ...",
    password: true,
    ignoreFocusOut: true,
    validateInput: (v) => (v.trim() ? null : "Token must not be empty."),
  });
  if (!token) return false;
  await auth.setToken(token);
  void vscode.window.showInformationMessage(`${USER_MESSAGE_PREFIX}signed in.`);
  return true;
}
