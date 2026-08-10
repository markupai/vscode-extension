import { describe, it, expect, vi, beforeEach } from "vitest";
import * as vscode from "vscode";
import {
  BadgeTarget,
  maybeShowFirstRunSignInNudge,
  SIGN_IN_NUDGE_STATE_KEY,
  SIGNED_IN_CONTEXT_KEY,
  updateSignedInVisuals,
} from "../src/signInExperience";

function makeGlobalState(initial: Record<string, unknown> = {}) {
  const store = new Map<string, unknown>(Object.entries(initial));
  const get = vi.fn((key: string) => store.get(key));
  const update = vi.fn((key: string, value: unknown) => {
    store.set(key, value);
    return Promise.resolve();
  });
  return { memento: { get, update } as unknown as vscode.Memento, get, update };
}

describe("updateSignedInVisuals", () => {
  beforeEach(() => {
    vi.mocked(vscode.commands.executeCommand).mockClear();
  });

  it("sets the signed-in context key and clears badges when signed in", async () => {
    const target: BadgeTarget = { badge: { value: 1, tooltip: "old" } };

    await updateSignedInVisuals(true, [target]);

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      "setContext",
      SIGNED_IN_CONTEXT_KEY,
      true,
    );
    expect(target.badge).toBeUndefined();
  });

  it("clears the context key and badges the views when signed out", async () => {
    const target: BadgeTarget = { badge: undefined };

    await updateSignedInVisuals(false, [target]);

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      "setContext",
      SIGNED_IN_CONTEXT_KEY,
      false,
    );
    expect(target.badge).toEqual({
      value: 1,
      tooltip: "Sign in to Markup AI to start checking content",
    });
  });
});

describe("maybeShowFirstRunSignInNudge", () => {
  beforeEach(() => {
    vi.mocked(vscode.window.showInformationMessage).mockClear();
    vi.mocked(vscode.commands.executeCommand).mockClear();
  });

  it("shows the nudge once and records it", async () => {
    const globalState = makeGlobalState();
    vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(undefined);

    await maybeShowFirstRunSignInNudge(globalState.memento, false);
    await maybeShowFirstRunSignInNudge(globalState.memento, false);

    expect(vscode.window.showInformationMessage).toHaveBeenCalledOnce();
    expect(globalState.update).toHaveBeenCalledWith(SIGN_IN_NUDGE_STATE_KEY, true);
  });

  it("does not show the nudge when already signed in", async () => {
    const globalState = makeGlobalState();

    await maybeShowFirstRunSignInNudge(globalState.memento, true);

    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
    expect(globalState.update).not.toHaveBeenCalled();
  });

  it("does not show the nudge when previously shown", async () => {
    const globalState = makeGlobalState({ [SIGN_IN_NUDGE_STATE_KEY]: true });

    await maybeShowFirstRunSignInNudge(globalState.memento, false);

    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });

  it("runs the sign-in command when the user picks Sign In", async () => {
    const globalState = makeGlobalState();
    vi.mocked(vscode.window.showInformationMessage).mockResolvedValue("Sign In" as never);

    await maybeShowFirstRunSignInNudge(globalState.memento, false);

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith("markupai-lint.signIn");
  });
});
