import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import { FakeInputBox, type QuickInputButton } from "./mocks/vscode";
import { presentSignInCode, SHOW_SIGN_IN_CODE_COMMAND } from "../src/signInCode";

const CODE = "BCDF-GHJK";

/** The boxes created so far, newest last. */
function boxes(): FakeInputBox[] {
  return vi.mocked(vscode.window.createInputBox).mock.results.map((r) => r.value as FakeInputBox);
}

function latestBox(): FakeInputBox {
  const all = boxes();
  const box = all.at(-1);
  if (!box) {
    throw new Error("no input box was created");
  }
  return box;
}

function buttonWithTooltip(box: FakeInputBox, tooltip: string): QuickInputButton {
  const button = box.buttons.find((b) => b.tooltip === tooltip);
  if (!button) {
    throw new Error(`no button with tooltip ${tooltip}`);
  }
  return button;
}

interface FakeStatusBarItem {
  command: string;
  show: ReturnType<typeof vi.fn>;
  hide: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
}

/** The status bar item of the latest presenter. */
function statusItem(): FakeStatusBarItem {
  const item = vi.mocked(vscode.window.createStatusBarItem).mock.results.at(-1)?.value as
    FakeStatusBarItem | undefined;
  if (!item) {
    throw new Error("no status bar item was created");
  }
  return item;
}

/** Runs the show-code command as a click on the status bar item would. */
function runShowCommand(): void {
  const registration = vi
    .mocked(vscode.commands.registerCommand)
    .mock.calls.filter(([id]) => id === SHOW_SIGN_IN_CODE_COMMAND)
    .at(-1);
  if (!registration) {
    throw new Error("the show-code command was not registered");
  }
  (registration[1] as () => void)();
}

describe("presentSignInCode", () => {
  beforeEach(() => {
    vi.mocked(vscode.window.createInputBox).mockImplementation(
      () => new FakeInputBox() as unknown as vscode.InputBox,
    );
    vi.mocked(vscode.window.createStatusBarItem).mockImplementation(
      () =>
        ({
          command: "",
          show: vi.fn(),
          hide: vi.fn(),
          dispose: vi.fn(),
        }) as unknown as vscode.StatusBarItem,
    );
    vi.mocked(vscode.commands.registerCommand).mockImplementation(() => ({ dispose: vi.fn() }));
  });

  it("shows the code as the box's preselected value with copy and cancel buttons", () => {
    presentSignInCode(CODE, vi.fn());

    const box = latestBox();
    expect(box.visible).toBe(true);
    expect(box.value).toBe(CODE);
    expect(box.valueSelection).toEqual([0, CODE.length]);
    expect(box.ignoreFocusOut).toBe(true);
    expect(box.prompt).toContain("Enter this code in your browser");
    expect(box.buttons.map((b) => b.tooltip)).toEqual(["Copy code", "Cancel sign-in"]);
  });

  it("the close button cancels exactly once and takes the box down", () => {
    const onCancel = vi.fn();
    presentSignInCode(CODE, onCancel);
    const box = latestBox();

    box.fireButton(buttonWithTooltip(box, "Cancel sign-in"));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(box.visible).toBe(false);
    expect(box.disposed).toBe(true);
    // No re-offer after an explicit cancel.
    expect(statusItem().show).not.toHaveBeenCalled();
  });

  it("Escape or another quick input does not cancel: a status bar item offers the code again", () => {
    const onCancel = vi.fn();
    presentSignInCode(CODE, onCancel);
    const box = latestBox();
    const item = statusItem();
    expect(item.show).not.toHaveBeenCalled();

    // VS Code fires onDidHide for Escape and for any other quick input opening.
    box.hide();

    expect(onCancel).not.toHaveBeenCalled();
    expect(item.show).toHaveBeenCalledTimes(1);
    expect(item.command).toBe(SHOW_SIGN_IN_CODE_COMMAND);
    // The hidden box is disposed; the sign-in keeps running underneath.
    expect(box.disposed).toBe(true);
  });

  it("the status bar item's command brings up a fresh box with the same code", () => {
    const onCancel = vi.fn();
    presentSignInCode(CODE, onCancel);
    const first = latestBox();
    const item = statusItem();

    first.hide();
    runShowCommand();

    expect(boxes()).toHaveLength(2);
    const second = latestBox();
    expect(second).not.toBe(first);
    expect(second.visible).toBe(true);
    expect(second.value).toBe(CODE);
    expect(item.hide).toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("show() brings the code back after the box was hidden", () => {
    const presenter = presentSignInCode(CODE, vi.fn());
    latestBox().hide();

    presenter.show();

    expect(boxes()).toHaveLength(2);
    expect(latestBox().visible).toBe(true);
  });

  it("disposing takes the box down without cancelling", () => {
    const onCancel = vi.fn();
    const presenter = presentSignInCode(CODE, onCancel);
    const box = latestBox();

    presenter.dispose();

    expect(box.disposed).toBe(true);
    expect(onCancel).not.toHaveBeenCalled();
    expect(statusItem().show).not.toHaveBeenCalled();
  });

  it("disposing after a hide takes the status bar item and its command down", () => {
    const presenter = presentSignInCode(CODE, vi.fn());
    latestBox().hide();
    const item = statusItem();
    const command = vi.mocked(vscode.commands.registerCommand).mock.results.at(-1)?.value as
      { dispose: ReturnType<typeof vi.fn> } | undefined;

    presenter.dispose();

    expect(item.dispose).toHaveBeenCalled();
    expect(command?.dispose).toHaveBeenCalled();
    // A late click on a stale item does nothing.
    runShowCommand();
    expect(boxes()).toHaveLength(1);
  });

  it("show() after dispose is a no-op", () => {
    const presenter = presentSignInCode(CODE, vi.fn());
    presenter.dispose();

    presenter.show();

    expect(boxes()).toHaveLength(1);
  });

  it("Enter and the copy button copy the code and leave the box open", () => {
    const writeText = vi.spyOn(vscode.env.clipboard, "writeText");
    presentSignInCode(CODE, vi.fn());
    const box = latestBox();

    box.fireAccept();
    expect(writeText).toHaveBeenCalledWith(CODE);
    expect(box.visible).toBe(true);
    expect(box.prompt).toContain("Copied");

    box.fireButton(buttonWithTooltip(box, "Copy code"));
    expect(writeText).toHaveBeenCalledTimes(2);
    expect(box.visible).toBe(true);
  });

  it("typing over the code restores it", () => {
    presentSignInCode(CODE, vi.fn());
    const box = latestBox();

    box.fireChangeValue("BCDF-GHJ");

    expect(box.value).toBe(CODE);
    expect(box.valueSelection).toEqual([0, CODE.length]);
  });
});
