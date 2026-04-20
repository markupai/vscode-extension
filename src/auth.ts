import * as vscode from "vscode";
import { USER_MESSAGE_PREFIX } from "./constants.js";

const TOKEN_KEY = "markupai.apiToken";

/**
 * Token-based authentication backed by VS Code's SecretStorage.
 * Tokens look like `mat_...` (MarkupAI personal access tokens) and
 * are sent as `Authorization: Bearer <token>` on every API request.
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
      throw new Error(`${USER_MESSAGE_PREFIX}API token must not be empty.`);
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
 * Prompt the user for an API token via the command palette.
 * Returns `true` if a token was stored, `false` if the user cancelled.
 */
export async function promptForToken(auth: AuthStore): Promise<boolean> {
  const token = await vscode.window.showInputBox({
    title: "MarkupAI Sign In",
    prompt: "Paste your MarkupAI API token (starts with `mat_`).",
    placeHolder: "mat_...",
    password: true,
    ignoreFocusOut: true,
    validateInput: (v) => {
      const t = v.trim();
      if (!t) return "Token must not be empty.";
      if (!t.startsWith("mat_")) return "Expected a token starting with `mat_`.";
      return null;
    },
  });
  if (!token) return false;
  await auth.setToken(token);
  void vscode.window.showInformationMessage(`${USER_MESSAGE_PREFIX}signed in.`);
  return true;
}
