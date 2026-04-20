/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
// ===================================================================
// Minimal vscode-api mock used by vitest (aliased via vitest.config.ts)
// Only the surface area that the extension code touches is implemented.
// ===================================================================

type Listener<T> = (e: T) => any;

export class EventEmitter<T> {
  private listeners: Listener<T>[] = [];
  event = (listener: Listener<T>): { dispose(): void } => {
    this.listeners.push(listener);
    return {
      dispose: () => {
        this.listeners = this.listeners.filter((l) => l !== listener);
      },
    };
  };
  fire(e: T): void {
    for (const l of this.listeners) l(e);
  }
  dispose(): void {
    this.listeners = [];
  }
}

export class Position {
  constructor(
    public line: number,
    public character: number,
  ) {}
}

export class Range {
  constructor(
    public start: Position,
    public end: Position,
  ) {}
}

export enum DiagnosticSeverity {
  Error = 0,
  Warning = 1,
  Information = 2,
  Hint = 3,
}

export class Diagnostic {
  source?: string;
  code?: string;
  constructor(
    public range: Range,
    public message: string,
    public severity: DiagnosticSeverity,
  ) {}
}

export enum CodeActionKind {
  QuickFix = "quickfix",
}
(CodeActionKind as any).QuickFix = "quickfix";

export class CodeAction {
  edit?: WorkspaceEdit;
  command?: { command: string; title: string; arguments?: unknown[] };
  isPreferred?: boolean;
  constructor(
    public title: string,
    public kind?: string,
  ) {}
}

export class WorkspaceEdit {
  private edits: { uri: Uri; range: Range; newText: string }[] = [];
  replace(uri: Uri, range: Range, newText: string): void {
    this.edits.push({ uri, range, newText });
  }
  size(): number {
    return this.edits.length;
  }
}

export class MarkdownString {
  value = "";
  isTrusted = false;
  supportHtml = false;
  appendMarkdown(s: string): this {
    this.value += s;
    return this;
  }
}

export class Hover {
  constructor(public contents: MarkdownString | MarkdownString[]) {}
}

export class Uri {
  private constructor(
    public scheme: string,
    public path: string,
    public fsPath: string,
  ) {}
  static file(p: string): Uri {
    return new Uri("file", p, p);
  }
  static parse(s: string): Uri {
    const idx = s.indexOf(":");
    if (idx === -1) return new Uri("file", s, s);
    return new Uri(s.slice(0, idx), s.slice(idx + 1), s.slice(idx + 1));
  }
  toString(): string {
    return `${this.scheme}:${this.path}`;
  }
}

export enum ConfigurationTarget {
  Global = 1,
  Workspace = 2,
  WorkspaceFolder = 3,
}

export enum ProgressLocation {
  SourceControl = 1,
  Window = 10,
  Notification = 15,
}

// ---- channels, views, commands --------------------------------------

export const _outputChannels: { name: string; lines: string[] }[] = [];

export const window = {
  activeTextEditor: undefined as any,
  createOutputChannel(name: string): {
    appendLine(s: string): void;
    append(s: string): void;
    show(): void;
    dispose(): void;
    readonly lines: string[];
    readonly name: string;
  } {
    const lines: string[] = [];
    const ch = {
      name,
      lines,
      appendLine(s: string) {
        lines.push(s);
      },
      append(s: string) {
        lines.push(s);
      },
      show() {
        /* no-op */
      },
      dispose() {
        /* no-op */
      },
    };
    _outputChannels.push({ name, lines });
    return ch;
  },
  showInformationMessage: (..._args: any[]) => Promise.resolve(undefined as any),
  showWarningMessage: (..._args: any[]) => Promise.resolve(undefined as any),
  showErrorMessage: (..._args: any[]) => Promise.resolve(undefined as any),
  showInputBox: (..._args: any[]) => Promise.resolve(undefined as any),
  registerWebviewViewProvider: (_id: string, _provider: unknown) => ({
    dispose() {
      /* noop */
    },
  }),
  withProgress: async (_opts: any, task: any) => {
    const token = {
      onCancellationRequested: (_cb: any) => ({
        dispose() {
          /* noop */
        },
      }),
    };
    return task({ report: (_: any) => undefined }, token);
  },
};

export const _registeredCommands = new Map<string, (...args: any[]) => any>();
export const commands = {
  registerCommand(id: string, cb: (...args: any[]) => any) {
    _registeredCommands.set(id, cb);
    return {
      dispose() {
        _registeredCommands.delete(id);
      },
    };
  },
  executeCommand: async (_id: string, ..._args: any[]) => undefined,
};

// ---- workspace -------------------------------------------------------

export const _configStore: Record<string, unknown> = {};

function getConfiguration(section: string): {
  get<T>(key: string, def?: T): T;
  update(key: string, value: unknown, _target?: ConfigurationTarget): Promise<void>;
} {
  return {
    get<T>(key: string, def?: T): T {
      const k = `${section}.${key}`;
      if (k in _configStore) return _configStore[k] as T;
      return def as T;
    },
    async update(key: string, value: unknown) {
      _configStore[`${section}.${key}`] = value;
    },
  };
}

export const _onDidChangeConfigurationEmitter = new EventEmitter<{
  affectsConfiguration(s: string): boolean;
}>();

export const workspace = {
  getConfiguration,
  workspaceFolders: [] as { uri: Uri; name: string; index: number }[] | undefined,
  textDocuments: [] as {
    uri: Uri;
    getText(): string;
    positionAt(o: number): Position;
    offsetAt(p: Position): number;
  }[],
  findFiles: async (_inc: string, _exc?: string, _max?: number): Promise<Uri[]> => [],
  asRelativePath: (uri: Uri | string, _includeWorkspaceFolder?: boolean): string =>
    typeof uri === "string" ? uri : uri.fsPath,
  fs: {
    readFile: async (_uri: Uri): Promise<Uint8Array> => new Uint8Array(),
  },
  onDidChangeConfiguration: _onDidChangeConfigurationEmitter.event,
};

// ---- languages -------------------------------------------------------

export const languages = {
  createDiagnosticCollection(name: string): {
    set(uri: Uri, diagnostics: Diagnostic[]): void;
    get(uri: Uri): Diagnostic[] | undefined;
    delete(uri: Uri): void;
    clear(): void;
    dispose(): void;
    readonly name: string;
  } {
    const store = new Map<string, Diagnostic[]>();
    return {
      name,
      set(uri: Uri, diagnostics: Diagnostic[]) {
        store.set(uri.toString(), diagnostics);
      },
      get(uri: Uri) {
        return store.get(uri.toString());
      },
      delete(uri: Uri) {
        store.delete(uri.toString());
      },
      clear() {
        store.clear();
      },
      dispose() {
        store.clear();
      },
    };
  },
  registerHoverProvider: (_s: any, _p: any) => ({
    dispose() {
      /* noop */
    },
  }),
  registerCodeActionsProvider: (_s: any, _p: any, _o?: any) => ({
    dispose() {
      /* noop */
    },
  }),
};

// ---- helpers for tests -----------------------------------------------

export function _resetVscodeMock(): void {
  _registeredCommands.clear();
  _outputChannels.length = 0;
  workspace.workspaceFolders = [];
  workspace.textDocuments = [];
  window.activeTextEditor = undefined;
  for (const k of Object.keys(_configStore)) delete _configStore[k];
}

// Default export so `import * as vscode from "vscode"` works.
export default {
  EventEmitter,
  Position,
  Range,
  Diagnostic,
  DiagnosticSeverity,
  CodeAction,
  CodeActionKind,
  WorkspaceEdit,
  MarkdownString,
  Hover,
  Uri,
  ConfigurationTarget,
  ProgressLocation,
  window,
  commands,
  workspace,
  languages,
};
