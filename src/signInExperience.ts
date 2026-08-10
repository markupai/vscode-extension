import * as vscode from "vscode";
import { USER_MESSAGE_PREFIX } from "./constants";

/** Context key driving the sign-in welcome views and walkthrough step. */
export const SIGNED_IN_CONTEXT_KEY = "markupai-lint.signedIn";

/** globalState key — the first-run sign-in nudge is shown at most once. */
export const SIGN_IN_NUDGE_STATE_KEY = "markupai-lint.signInNudgeShown";

const BADGE_TOOLTIP = "Sign in to Markup AI to start checking content";

/** The `badge` slice of vscode.TreeView — keeps callers and tests light. */
export interface BadgeTarget {
  badge?: vscode.ViewBadge | undefined;
}

/**
 * Mirrors the auth state into the passive sign-in surfaces: the context key
 * (welcome views, walkthrough completion) and the activity bar badge.
 */
export async function updateSignedInVisuals(
  signedIn: boolean,
  badgeTargets: BadgeTarget[],
): Promise<void> {
  await vscode.commands.executeCommand("setContext", SIGNED_IN_CONTEXT_KEY, signedIn);
  const badge = signedIn ? undefined : { value: 1, tooltip: BADGE_TOOLTIP };
  for (const target of badgeTargets) {
    target.badge = badge;
  }
}

/**
 * One-time toast pointing new users at sign-in. The flag is set before the
 * (long-lived) toast resolves so a reload can never show it twice.
 */
export async function maybeShowFirstRunSignInNudge(
  globalState: vscode.Memento,
  signedIn: boolean,
): Promise<void> {
  if (signedIn || globalState.get(SIGN_IN_NUDGE_STATE_KEY)) {
    return;
  }
  await globalState.update(SIGN_IN_NUDGE_STATE_KEY, true);

  const action = await vscode.window.showInformationMessage(
    `${USER_MESSAGE_PREFIX}sign in to start checking your content for style and grammar issues.`,
    "Sign In",
    "Later",
  );
  if (action === "Sign In") {
    await vscode.commands.executeCommand("markupai-lint.signIn");
  }
}
