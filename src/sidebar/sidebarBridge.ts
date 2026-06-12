import * as vscode from "vscode";
import { MimeType, TextLookupError, type ContentInfo } from "@markupai/sidebar-adapter";
import { CheckSession, CheckSessionStore, type SpanRange } from "./checkSession";
import { SidebarRpcHandler } from "./sidebarViewProvider";
import { isSupportedScheme } from "../utils";

interface ContentReplacementArg {
  suggestion: string;
  range: SpanRange;
}

/**
 * Extension-host implementation of the sidebar's PluginInterface.
 *
 * Content requests snapshot the active document into a CheckSession;
 * later card interactions (highlight, apply) resolve their ranges through
 * that session against the live document — see checkSession.ts for the
 * resolution tiers. Sidebar-flagged text is shown with an editor
 * decoration (no diagnostics — native-mode underlines stay out of
 * sidebar mode).
 */
export class SidebarBridge implements SidebarRpcHandler, vscode.Disposable {
  private readonly sessions = new CheckSessionStore();
  private lastEditor: vscode.TextEditor | undefined;
  private readonly highlight: vscode.TextEditorDecorationType;

  constructor() {
    this.highlight = vscode.window.createTextEditorDecorationType({
      backgroundColor: new vscode.ThemeColor("editor.findMatchHighlightBackground"),
      border: "1px solid",
      borderColor: new vscode.ThemeColor("editor.findMatchHighlightBorder"),
      overviewRulerColor: new vscode.ThemeColor("editorOverviewRuler.findMatchForeground"),
      overviewRulerLane: vscode.OverviewRulerLane.Center,
    });
  }

  /** Track the editor the sidebar operates on (webview focus steals activeTextEditor). */
  trackEditor(editor: vscode.TextEditor | undefined): void {
    if (editor && isSupportedScheme(editor.document.uri.scheme)) {
      this.lastEditor = editor;
    }
  }

  /** Forget state for a closed document. */
  handleDocumentClosed(uri: vscode.Uri): void {
    this.sessions.delete(uri.toString());
    if (this.lastEditor?.document.uri.toString() === uri.toString()) {
      this.lastEditor = undefined;
    }
  }

  async handle(method: string, args: unknown[]): Promise<unknown> {
    switch (method) {
      case "getContent":
        return this.getContent(false);
      case "getSelectedContent":
        return this.getContent(true);
      case "selectContent":
        return this.selectContent(args[0] as SpanRange);
      case "replaceContent":
        return this.replaceContent(args[0] as string, args[1] as SpanRange);
      case "replaceMultipleContents":
        return this.replaceMultipleContents(args[0] as ContentReplacementArg[]);
      case "openAuthUrl": {
        const url = args[0];
        if (typeof url !== "string" || !url.startsWith("https://")) {
          throw new Error("Invalid auth URL");
        }
        await vscode.env.openExternal(vscode.Uri.parse(url));
        return undefined;
      }
      default:
        throw new Error(`Unsupported sidebar request: ${method}`);
    }
  }

  // ==========================================================================
  // Content
  // ==========================================================================

  private getContent(selectionOnly: boolean): ContentInfo {
    const editor = this.resolveEditor();
    if (!editor) {
      throw new Error("Open a document to check it with MarkupAI.");
    }

    const document = editor.document;
    const fullText = document.getText();

    let baseOffset = 0;
    let content = fullText;
    if (selectionOnly) {
      const selection = editor.selection;
      if (selection.isEmpty) {
        throw new Error("Select some text in the editor first.");
      }
      baseOffset = document.offsetAt(selection.start);
      content = document.getText(selection);
    }

    this.sessions.set(
      new CheckSession(
        document.uri.toString(),
        fullText,
        document.version,
        baseOffset,
        content.length,
      ),
    );

    const fileName = document.uri.path.split("/").pop() || document.uri.path;
    return {
      content,
      documentReference: document.uri.toString(),
      documentName: fileName,
      mimeType: mimeTypeForFileName(fileName),
    };
  }

  private resolveEditor(): vscode.TextEditor | undefined {
    const active = vscode.window.activeTextEditor;
    if (active && isSupportedScheme(active.document.uri.scheme)) {
      return active;
    }
    if (
      this.lastEditor &&
      vscode.window.visibleTextEditors.includes(this.lastEditor) &&
      !this.lastEditor.document.isClosed
    ) {
      return this.lastEditor;
    }
    return undefined;
  }

  // ==========================================================================
  // Highlight (card click)
  // ==========================================================================

  private async selectContent(range: SpanRange): Promise<void> {
    const { editor, span } = await this.resolveSessionRange(range);

    const start = editor.document.positionAt(span.start);
    const end = editor.document.positionAt(span.end);
    const target = new vscode.Range(start, end);

    editor.selection = new vscode.Selection(target.start, target.end);
    editor.revealRange(target, vscode.TextEditorRevealType.InCenter);
    editor.setDecorations(this.highlight, [target]);
  }

  // ==========================================================================
  // Replacement
  // ==========================================================================

  private async replaceContent(suggestion: string, range: SpanRange): Promise<void> {
    const { editor, span } = await this.resolveSessionRange(range);

    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      editor.document.uri,
      new vscode.Range(
        editor.document.positionAt(span.start),
        editor.document.positionAt(span.end),
      ),
      suggestion,
    );
    const applied = await vscode.workspace.applyEdit(edit);
    if (!applied) {
      throw new TextLookupError("The replacement could not be applied.");
    }
    editor.setDecorations(this.highlight, []);
  }

  private async replaceMultipleContents(replacements: ContentReplacementArg[]): Promise<void> {
    if (!Array.isArray(replacements) || replacements.length === 0) {
      return;
    }

    const { session, editor } = await this.requireSession();
    const document = editor.document;
    const currentText = document.getText();

    const resolved: { suggestion: string; span: SpanRange }[] = [];
    let failed = 0;
    for (const replacement of replacements) {
      const span = session.resolveRange(replacement.range, currentText, document.version);
      if (span) {
        resolved.push({ suggestion: replacement.suggestion, span });
      } else {
        failed++;
      }
    }

    if (resolved.length === 0) {
      throw new TextLookupError(
        "None of the suggestions could be located — the document has changed too much. Re-run the check.",
      );
    }

    // Apply bottom-up in one edit so earlier replacements don't shift
    // later offsets; a single undo step reverts the whole batch.
    resolved.sort((a, b) => b.span.start - a.span.start);
    const edit = new vscode.WorkspaceEdit();
    for (const { suggestion, span } of resolved) {
      edit.replace(
        document.uri,
        new vscode.Range(document.positionAt(span.start), document.positionAt(span.end)),
        suggestion,
      );
    }
    const applied = await vscode.workspace.applyEdit(edit);
    if (!applied) {
      throw new TextLookupError("The replacements could not be applied.");
    }
    editor.setDecorations(this.highlight, []);

    if (failed > 0) {
      throw new TextLookupError(
        `${String(failed)} of ${String(replacements.length)} suggestions could not be located and were skipped. Re-run the check for current results.`,
      );
    }
  }

  // ==========================================================================
  // Session helpers
  // ==========================================================================

  private async requireSession(): Promise<{ session: CheckSession; editor: vscode.TextEditor }> {
    const session = this.sessions.getLatest();
    if (!session) {
      throw new TextLookupError("No check has been run yet.");
    }

    const uri = vscode.Uri.parse(session.uri);
    const document = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(document, {
      preserveFocus: true,
      preview: false,
    });
    return { session, editor };
  }

  private async resolveSessionRange(
    range: SpanRange,
  ): Promise<{ session: CheckSession; editor: vscode.TextEditor; span: SpanRange }> {
    const { session, editor } = await this.requireSession();
    const span = session.resolveRange(range, editor.document.getText(), editor.document.version);
    if (!span) {
      throw new TextLookupError(
        "This text has changed since the check and can no longer be located. Re-run the check.",
      );
    }
    return { session, editor, span };
  }

  dispose(): void {
    this.highlight.dispose();
    this.sessions.clear();
  }
}

function mimeTypeForFileName(fileName: string): MimeType {
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  switch (extension) {
    case "md":
    case "markdown":
      return MimeType.TEXT_MARKDOWN;
    case "html":
    case "htm":
      return MimeType.TEXT_HTML;
    case "dita":
    case "xml":
      return MimeType.APPLICATION_DITA_XML;
    default:
      return MimeType.TEXT_PLAIN;
  }
}
