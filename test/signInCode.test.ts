import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import { FakeInputBox, type QuickInputButton } from "./mocks/vscode";
import { presentSignInCode } from "../src/signInCode";

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

/** Lets a `void promise.then(...)` chain settle. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("presentSignInCode", () => {
  beforeEach(() => {
    vi.mocked(vscode.window.createInputBox).mockImplementation(
      () => new FakeInputBox() as unknown as vscode.InputBox,
    );
    // By default the re-offer notification is dismissed without a choice.
    vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(undefined);
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
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });

  it("Escape or another quick input does not cancel: the code is offered again", async () => {
    const onCancel = vi.fn();
    presentSignInCode(CODE, onCancel);
    const box = latestBox();

    // VS Code fires onDidHide for Escape and for any other quick input opening.
    box.hide();
    await flush();

    expect(onCancel).not.toHaveBeenCalled();
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining("still waiting for your code"),
      "Show code",
      "Cancel sign-in",
    );
    // The hidden box is disposed; the sign-in keeps running underneath.
    expect(box.disposed).toBe(true);
  });

  it("'Show code' on the re-offer brings up a fresh box with the same code", async () => {
    vi.mocked(vscode.window.showInformationMessage).mockResolvedValueOnce("Show code" as never);
    const onCancel = vi.fn();
    presentSignInCode(CODE, onCancel);
    const first = latestBox();

    first.hide();
    await flush();

    expect(boxes()).toHaveLength(2);
    const second = latestBox();
    expect(second).not.toBe(first);
    expect(second.visible).toBe(true);
    expect(second.value).toBe(CODE);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("'Cancel sign-in' on the re-offer cancels", async () => {
    vi.mocked(vscode.window.showInformationMessage).mockResolvedValueOnce(
      "Cancel sign-in" as never,
    );
    const onCancel = vi.fn();
    presentSignInCode(CODE, onCancel);

    latestBox().hide();
    await flush();

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(boxes()).toHaveLength(1);
  });

  it("a re-offer answered after the attempt ended does nothing", async () => {
    let answer!: (value: string | undefined) => void;
    vi.mocked(vscode.window.showInformationMessage).mockReturnValueOnce(
      new Promise<string | undefined>((resolve) => {
        answer = resolve;
      }) as never,
    );
    const onCancel = vi.fn();
    const presenter = presentSignInCode(CODE, onCancel);

    latestBox().hide();
    await flush();
    presenter.dispose();
    answer("Show code");
    await flush();

    expect(boxes()).toHaveLength(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("disposing takes the box down without cancelling", () => {
    const onCancel = vi.fn();
    const presenter = presentSignInCode(CODE, onCancel);
    const box = latestBox();

    presenter.dispose();

    expect(box.disposed).toBe(true);
    expect(onCancel).not.toHaveBeenCalled();
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
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
