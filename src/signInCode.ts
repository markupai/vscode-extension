import * as vscode from "vscode";

/**
 * The relay's confirmation code. After signing in, the browser asks for it and
 * the relay releases the sign-in only when it matches, so the user must be
 * able to read it the whole time they are in the browser.
 *
 * A quick input rather than a toast: a toast reads as a notification and can
 * be dismissed or hidden behind the bell, while this is plainly a step to act
 * on, drawn in VS Code's own UI at the top of the window. The code is the
 * box's value, preselected, so Ctrl+C copies it at once; Enter and the copy
 * button copy it and leave the box open. `ignoreFocusOut` keeps it open while
 * the browser is in front.
 *
 * VS Code shows one quick input at a time, and `onDidHide` fires for the
 * close button, for Escape, and whenever another quick input opens (the
 * command palette, a file picker, this extension's own pickers). The stable
 * API gives no reason, so only the close button is taken as a cancel. Any
 * other hide keeps the sign-in running and puts a status bar item up that
 * brings the code back, so the palette stays usable for the whole wait. A
 * status bar item rather than a notification: the presenter can take it down
 * when the attempt ends, where a notification would linger next to the
 * outcome. The box is the only place the code appears.
 */

export interface SignInCodePresenter extends vscode.Disposable {
  /** Shows the code box again; a no-op once the presenter is disposed. */
  show(): void;
}

/** Runs `show()` on the presenter in flight; registered only while one is. */
export const SHOW_SIGN_IN_CODE_COMMAND = "markupai-lint.showSignInCode";

/**
 * Presents `code` for as long as the sign-in attempt runs. `onCancel` fires
 * once, and only when the user asks to cancel with the box's close button.
 * Disposing the presenter takes the box and the status bar item down without
 * calling `onCancel`; for when the attempt ends on its own, whatever the
 * outcome.
 */
export function presentSignInCode(code: string, onCancel: () => void): SignInCodePresenter {
  let ended = false;
  let cancelled = false;
  let box: vscode.InputBox | undefined;

  const cancel = () => {
    if (ended || cancelled) {
      return;
    }
    cancelled = true;
    onCancel();
  };

  const reOffer = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  reOffer.text = "$(key) Markup AI sign-in code";
  reOffer.tooltip = "The browser sign-in is still waiting for your code. Click to show it.";
  reOffer.command = SHOW_SIGN_IN_CODE_COMMAND;
  const showCommand = vscode.commands.registerCommand(SHOW_SIGN_IN_CODE_COMMAND, () => {
    show();
  });

  const show = () => {
    if (ended || cancelled) {
      return;
    }
    reOffer.hide();
    box?.dispose();
    box = createCodeBox(code, {
      onCancel: () => {
        reOffer.hide();
        cancel();
      },
      onHidden: () => {
        reOffer.show();
      },
    });
    box.show();
  };

  show();
  return {
    show,
    dispose: () => {
      ended = true;
      box?.dispose();
      box = undefined;
      reOffer.dispose();
      showCommand.dispose();
    },
  };
}

interface CodeBoxCallbacks {
  /** The user pressed the box's close button. */
  onCancel: () => void;
  /** The box went away for any other reason (Escape, another quick input). */
  onHidden: () => void;
}

function createCodeBox(code: string, callbacks: CodeBoxCallbacks): vscode.InputBox {
  const copyButton: vscode.QuickInputButton = {
    iconPath: new vscode.ThemeIcon("copy"),
    tooltip: "Copy code",
  };
  const closeButton: vscode.QuickInputButton = {
    iconPath: new vscode.ThemeIcon("close"),
    tooltip: "Cancel sign-in",
  };
  const box = vscode.window.createInputBox();
  box.title = "Sign in to Markup AI";
  box.prompt = "Enter this code in your browser to finish signing in";
  box.value = code;
  box.valueSelection = [0, code.length];
  box.ignoreFocusOut = true;
  box.buttons = [copyButton, closeButton];

  const copy = () => {
    void vscode.env.clipboard.writeText(code);
    box.prompt = "Copied. Enter it in your browser to finish signing in";
  };
  let closing = false;
  box.onDidTriggerButton((button) => {
    if (button === closeButton) {
      closing = true;
      box.hide();
      return;
    }
    copy();
  });
  box.onDidAccept(copy);
  // The box is read-only in spirit: typing over the code would hide it.
  box.onDidChangeValue((value) => {
    if (value !== code) {
      box.value = code;
      box.valueSelection = [0, code.length];
    }
  });
  // onDidHide also fires for the dispose that ends the attempt; `settled`
  // keeps that from reading as the user hiding the box.
  let settled = false;
  box.onDidHide(() => {
    if (settled) {
      return;
    }
    settled = true;
    box.dispose();
    if (closing) {
      callbacks.onCancel();
    } else {
      callbacks.onHidden();
    }
  });
  const dispose = box.dispose.bind(box);
  box.dispose = () => {
    settled = true;
    dispose();
  };
  return box;
}
