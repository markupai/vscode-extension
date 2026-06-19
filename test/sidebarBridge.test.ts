import { describe, it, expect, vi, beforeEach } from "vitest";
import * as vscode from "vscode";
import { isTextLookupError } from "@markupai/sidebar-adapter";
import { SidebarBridge } from "../src/sidebar/sidebarBridge";

const TEXT = "The quick brown fox jumps over the lazy dog.";

interface MockEditor {
  document: {
    uri: vscode.Uri;
    version: number;
    isClosed: boolean;
    getText: ReturnType<typeof vi.fn>;
    offsetAt: ReturnType<typeof vi.fn>;
    positionAt: ReturnType<typeof vi.fn>;
  };
  selection: { isEmpty: boolean; start: vscode.Position; end: vscode.Position };
  revealRange: ReturnType<typeof vi.fn>;
  setDecorations: ReturnType<typeof vi.fn>;
}

function makeEditor(text = TEXT, uriPath = "/doc.md", version = 1): MockEditor {
  const uri = vscode.Uri.file(uriPath);
  return {
    document: {
      uri,
      version,
      isClosed: false,
      getText: vi.fn((range?: { start: vscode.Position; end: vscode.Position }) => {
        if (!range) {
          return text;
        }
        return text.slice(range.start.character, range.end.character);
      }),
      offsetAt: vi.fn((position: vscode.Position) => position.character),
      positionAt: vi.fn((offset: number) => new vscode.Position(0, offset)),
    },
    selection: {
      isEmpty: true,
      start: new vscode.Position(0, 0),
      end: new vscode.Position(0, 0),
    },
    revealRange: vi.fn(),
    setDecorations: vi.fn(),
  };
}

function setActiveEditor(editor: MockEditor | undefined): void {
  (vscode.window as unknown as { activeTextEditor: unknown }).activeTextEditor = editor;
}

function stubEditorReopen(editor: MockEditor): void {
  vi.mocked(vscode.workspace.openTextDocument).mockResolvedValue(
    editor.document as unknown as vscode.TextDocument,
  );
  vi.mocked(vscode.window.showTextDocument).mockResolvedValue(
    editor as unknown as vscode.TextEditor,
  );
}

describe("SidebarBridge", () => {
  let bridge: SidebarBridge;

  beforeEach(() => {
    bridge = new SidebarBridge();
    setActiveEditor(undefined);
  });

  describe("getContent", () => {
    it("returns the active document with markdown mime type", async () => {
      const editor = makeEditor();
      setActiveEditor(editor);

      const info = (await bridge.handle("getContent", [])) as {
        content: string;
        documentReference: string;
        documentName: string;
        mimeType: string;
      };

      expect(info.content).toBe(TEXT);
      expect(info.documentName).toBe("doc.md");
      expect(info.mimeType).toBe("text/markdown");
      expect(info.documentReference).toContain("doc.md");
    });

    it("maps dita and html extensions to their mime types", async () => {
      const dita = makeEditor(TEXT, "/topic.dita");
      setActiveEditor(dita);
      const info = (await bridge.handle("getContent", [])) as { mimeType: string };
      expect(info.mimeType).toBe("application/dita+xml");

      const html = makeEditor(TEXT, "/page.html");
      setActiveEditor(html);
      const htmlInfo = (await bridge.handle("getContent", [])) as { mimeType: string };
      expect(htmlInfo.mimeType).toBe("text/html");
    });

    it("throws when no editor is available", async () => {
      await expect(bridge.handle("getContent", [])).rejects.toThrow("Open a document");
    });

    it("falls back to the tracked editor when the webview has focus", async () => {
      const editor = makeEditor();
      bridge.trackEditor(editor as unknown as vscode.TextEditor);
      (vscode.window as unknown as { visibleTextEditors: unknown[] }).visibleTextEditors = [editor];
      setActiveEditor(undefined); // focus is in the webview

      const info = (await bridge.handle("getContent", [])) as { content: string };
      expect(info.content).toBe(TEXT);
    });
  });

  describe("getSelectedContent", () => {
    it("returns the selection and records its base offset", async () => {
      const editor = makeEditor();
      editor.selection = {
        isEmpty: false,
        start: new vscode.Position(0, 10),
        end: new vscode.Position(0, 19),
      };
      setActiveEditor(editor);
      stubEditorReopen(editor);

      const info = (await bridge.handle("getSelectedContent", [])) as { content: string };
      expect(info.content).toBe("brown fox");

      // Range [6, 9) within the selection = "fox" at [16, 19) in the document.
      await bridge.handle("selectContent", [{ start: 6, end: 9 }]);
      const revealed = editor.revealRange.mock.calls[0][0] as vscode.Range;
      expect(revealed.start.character).toBe(16);
      expect(revealed.end.character).toBe(19);
    });

    it("throws when the selection is empty", async () => {
      const editor = makeEditor();
      setActiveEditor(editor);
      await expect(bridge.handle("getSelectedContent", [])).rejects.toThrow("Select some text");
    });
  });

  describe("selectContent", () => {
    it("highlights and reveals the resolved range", async () => {
      const editor = makeEditor();
      setActiveEditor(editor);
      stubEditorReopen(editor);
      await bridge.handle("getContent", []);

      await bridge.handle("selectContent", [{ start: 4, end: 9 }]); // "quick"

      expect(editor.revealRange).toHaveBeenCalledOnce();
      expect(editor.setDecorations).toHaveBeenCalledOnce();
      const [, ranges] = editor.setDecorations.mock.calls[0] as [unknown, vscode.Range[]];
      expect(ranges[0].start.character).toBe(4);
      expect(ranges[0].end.character).toBe(9);
    });

    it("resolves ranges after the document was edited", async () => {
      const editor = makeEditor();
      setActiveEditor(editor);
      stubEditorReopen(editor);
      await bridge.handle("getContent", []);

      const edited = "Hello! " + TEXT;
      editor.document.getText = vi.fn(() => edited);
      editor.document.version = 2;

      await bridge.handle("selectContent", [{ start: 4, end: 9 }]);
      const revealed = editor.revealRange.mock.calls[0][0] as vscode.Range;
      expect(revealed.start.character).toBe(11);
      expect(revealed.end.character).toBe(16);
    });

    it("throws TextLookupError when no check has run", async () => {
      const error = await bridge
        .handle("selectContent", [{ start: 0, end: 4 }])
        .catch((e: unknown) => e);
      expect(isTextLookupError(error)).toBe(true);
    });

    it("throws TextLookupError when the text was deleted", async () => {
      const editor = makeEditor();
      setActiveEditor(editor);
      stubEditorReopen(editor);
      await bridge.handle("getContent", []);

      editor.document.getText = vi.fn(() => TEXT.replace("quick brown ", ""));
      editor.document.version = 2;

      const error = await bridge
        .handle("selectContent", [{ start: 4, end: 9 }])
        .catch((e: unknown) => e);
      expect(isTextLookupError(error)).toBe(true);
    });
  });

  describe("replaceContent", () => {
    it("applies the suggestion via a workspace edit", async () => {
      const editor = makeEditor();
      setActiveEditor(editor);
      stubEditorReopen(editor);
      vi.mocked(vscode.workspace.applyEdit).mockResolvedValue(true);
      await bridge.handle("getContent", []);

      await bridge.handle("replaceContent", ["rapid", { start: 4, end: 9 }]);

      expect(vscode.workspace.applyEdit).toHaveBeenCalledOnce();
      expect(editor.setDecorations).toHaveBeenCalledWith(expect.anything(), []);
    });

    it("throws TextLookupError when the edit is rejected", async () => {
      const editor = makeEditor();
      setActiveEditor(editor);
      stubEditorReopen(editor);
      vi.mocked(vscode.workspace.applyEdit).mockResolvedValue(false);
      await bridge.handle("getContent", []);

      const error = await bridge
        .handle("replaceContent", ["rapid", { start: 4, end: 9 }])
        .catch((e: unknown) => e);
      expect(isTextLookupError(error)).toBe(true);
    });
  });

  describe("replaceMultipleContents", () => {
    it("applies all replacements in one edit, bottom-up", async () => {
      const editor = makeEditor();
      setActiveEditor(editor);
      stubEditorReopen(editor);
      vi.mocked(vscode.workspace.applyEdit).mockResolvedValue(true);
      await bridge.handle("getContent", []);

      await bridge.handle("replaceMultipleContents", [
        [
          { suggestion: "rapid", range: { start: 4, end: 9 } }, // quick
          { suggestion: "cat", range: { start: 40, end: 43 } }, // dog
        ],
      ]);

      expect(vscode.workspace.applyEdit).toHaveBeenCalledOnce();
    });

    it("skips unlocatable replacements and reports the count", async () => {
      const editor = makeEditor();
      setActiveEditor(editor);
      stubEditorReopen(editor);
      vi.mocked(vscode.workspace.applyEdit).mockResolvedValue(true);
      await bridge.handle("getContent", []);

      editor.document.getText = vi.fn(() => TEXT.replace("quick brown ", ""));
      editor.document.version = 2;

      const error = await bridge
        .handle("replaceMultipleContents", [
          [
            { suggestion: "rapid", range: { start: 4, end: 9 } }, // deleted
            { suggestion: "cat", range: { start: 40, end: 43 } }, // still present
          ],
        ])
        .catch((e: unknown) => e);

      expect(vscode.workspace.applyEdit).toHaveBeenCalledOnce();
      expect(isTextLookupError(error)).toBe(true);
      expect((error as Error).message).toContain("1 of 2");
    });

    it("is a no-op for empty input", async () => {
      await expect(bridge.handle("replaceMultipleContents", [[]])).resolves.toBeUndefined();
      expect(vscode.workspace.applyEdit).not.toHaveBeenCalled();
    });
  });

  describe("openAuthUrl", () => {
    it("opens https auth URLs externally", async () => {
      await bridge.handle("openAuthUrl", [
        "https://api.markup.ai/oauth/vscode-extension/authorize?x=1",
      ]);
      expect(vscode.env.openExternal).toHaveBeenCalledOnce();
    });

    it("rejects non-https URLs", async () => {
      await expect(bridge.handle("openAuthUrl", ["javascript:alert(1)"])).rejects.toThrow(
        "Invalid auth URL",
      );
      expect(vscode.env.openExternal).not.toHaveBeenCalled();
    });
  });

  describe("uncovered branches", () => {
    it("maps unknown extensions to text/plain", async () => {
      const editor = makeEditor(TEXT, "/notes.xyz");
      setActiveEditor(editor);
      const info = (await bridge.handle("getContent", [])) as { mimeType: string };
      expect(info.mimeType).toBe("text/plain");
    });

    it("ignores editors with unsupported schemes when tracking", async () => {
      const editor = makeEditor();
      (editor.document.uri as { scheme: string }).scheme = "output";
      bridge.trackEditor(editor as unknown as vscode.TextEditor);
      await expect(bridge.handle("getContent", [])).rejects.toThrow("Open a document");
    });

    it("keeps the tracked editor when an unrelated document closes", async () => {
      const editor = makeEditor();
      bridge.trackEditor(editor as unknown as vscode.TextEditor);
      (vscode.window as unknown as { visibleTextEditors: unknown[] }).visibleTextEditors = [editor];

      bridge.handleDocumentClosed(vscode.Uri.file("/other.md"));

      const info = (await bridge.handle("getContent", [])) as { content: string };
      expect(info.content).toBe(TEXT);
    });

    it("throws when no batch replacement can be located", async () => {
      const editor = makeEditor();
      setActiveEditor(editor);
      stubEditorReopen(editor);
      vi.mocked(vscode.workspace.applyEdit).mockResolvedValue(true);
      await bridge.handle("getContent", []);

      editor.document.getText = vi.fn(() => "entirely replaced content");
      editor.document.version = 2;

      const error = await bridge
        .handle("replaceMultipleContents", [[{ suggestion: "rapid", range: { start: 4, end: 9 } }]])
        .catch((e: unknown) => e);

      expect(isTextLookupError(error)).toBe(true);
      expect((error as Error).message).toContain("None of the suggestions");
      expect(vscode.workspace.applyEdit).not.toHaveBeenCalled();
    });

    it("throws when the batch edit is rejected by the workspace", async () => {
      const editor = makeEditor();
      setActiveEditor(editor);
      stubEditorReopen(editor);
      vi.mocked(vscode.workspace.applyEdit).mockResolvedValue(false);
      await bridge.handle("getContent", []);

      const error = await bridge
        .handle("replaceMultipleContents", [[{ suggestion: "rapid", range: { start: 4, end: 9 } }]])
        .catch((e: unknown) => e);

      expect(isTextLookupError(error)).toBe(true);
      expect((error as Error).message).toContain("could not be applied");
    });

    it("disposes the decoration and sessions", () => {
      expect(() => {
        bridge.dispose();
      }).not.toThrow();
    });
  });

  it("rejects unknown methods", async () => {
    await expect(bridge.handle("nope", [])).rejects.toThrow("Unsupported sidebar request");
  });

  it("clears tracked state when the document closes", async () => {
    const editor = makeEditor();
    bridge.trackEditor(editor as unknown as vscode.TextEditor);
    (vscode.window as unknown as { visibleTextEditors: unknown[] }).visibleTextEditors = [editor];

    bridge.handleDocumentClosed(editor.document.uri);

    await expect(bridge.handle("getContent", [])).rejects.toThrow("Open a document");
  });
});
