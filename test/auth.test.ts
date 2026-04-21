import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import { AuthStore, promptForToken } from "../src/auth.js";

function makeSecrets(): vscode.SecretStorage {
  const store = new Map<string, string>();
  return {
    get: async (key: string) => store.get(key),
    store: async (key: string, v: string) => {
      store.set(key, v);
    },
    delete: async (key: string) => {
      store.delete(key);
    },
    onDidChange: new vscode.EventEmitter<vscode.SecretStorageChangeEvent>().event,
  } as unknown as vscode.SecretStorage;
}

describe("AuthStore", () => {
  it("stores, reads, and clears tokens", async () => {
    const auth = new AuthStore(makeSecrets());
    expect(await auth.hasToken()).toBe(false);
    await auth.setToken("mat_abc");
    expect(await auth.getToken()).toBe("mat_abc");
    expect(await auth.hasToken()).toBe(true);
    await auth.clearToken();
    expect(await auth.hasToken()).toBe(false);
    auth.dispose();
  });

  it("rejects empty tokens", async () => {
    const auth = new AuthStore(makeSecrets());
    await expect(auth.setToken("   ")).rejects.toThrow(/must not be empty/);
  });

  it("emits onDidChange on set and clear", async () => {
    const auth = new AuthStore(makeSecrets());
    const listener = vi.fn();
    auth.onDidChange(listener);
    await auth.setToken("mat_abc");
    await auth.clearToken();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenNthCalledWith(1, "mat_abc");
    expect(listener).toHaveBeenNthCalledWith(2, undefined);
  });
});

describe("promptForToken", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("stores the entered token and returns true", async () => {
    vi.spyOn(vscode.window, "showInputBox").mockResolvedValue("mat_xyz");
    const auth = new AuthStore(makeSecrets());
    const ok = await promptForToken(auth);
    expect(ok).toBe(true);
    expect(await auth.getToken()).toBe("mat_xyz");
  });

  it("returns false when the user cancels", async () => {
    vi.spyOn(vscode.window, "showInputBox").mockResolvedValue(undefined);
    const auth = new AuthStore(makeSecrets());
    const ok = await promptForToken(auth);
    expect(ok).toBe(false);
    expect(await auth.hasToken()).toBe(false);
  });

  it("rejects empty tokens at the input-box validator", async () => {
    let captured: ((v: string) => string | null) | undefined;
    vi.spyOn(vscode.window, "showInputBox").mockImplementation(
      async (opts?: vscode.InputBoxOptions) => {
        captured = opts?.validateInput as typeof captured;
        return undefined;
      },
    );
    await promptForToken(new AuthStore(makeSecrets()));
    expect(captured).toBeDefined();
    expect(captured!("")).toMatch(/not be empty/);
    expect(captured!("eyJ.abc")).toBeNull();
  });
});
