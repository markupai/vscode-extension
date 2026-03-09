// Mock VS Code API for testing
import { vi } from "vitest";

export enum DiagnosticSeverity {
  Error = 0,
  Warning = 1,
  Information = 2,
  Hint = 3,
}

export enum ConfigurationTarget {
  Global = 1,
  Workspace = 2,
  WorkspaceFolder = 3,
}

export enum StatusBarAlignment {
  Left = 1,
  Right = 2,
}

export enum FileType {
  Unknown = 0,
  File = 1,
  Directory = 2,
  SymbolicLink = 64,
}

export enum TreeItemCollapsibleState {
  None = 0,
  Collapsed = 1,
  Expanded = 2,
}

export enum ProgressLocation {
  SourceControl = 1,
  Window = 10,
  Notification = 15,
}

export enum TextEditorRevealType {
  Default = 0,
  InCenter = 1,
  InCenterIfOutsideViewport = 2,
  AtTop = 3,
}

export enum UIKind {
  Desktop = 1,
  Web = 2,
}

export class Range {
  start: Position;
  end: Position;

  constructor(start: Position, end: Position) {
    this.start = start;
    this.end = end;
  }

  contains(position: Position): boolean {
    return position.line >= this.start.line && position.line <= this.end.line;
  }

  isEqual(other: Range): boolean {
    return this.start.isEqual(other.start) && this.end.isEqual(other.end);
  }
}

export class Position {
  line: number;
  character: number;

  constructor(line: number, character: number) {
    this.line = line;
    this.character = character;
  }

  isEqual(other: Position): boolean {
    return this.line === other.line && this.character === other.character;
  }

  isBefore(other: Position): boolean {
    if (this.line < other.line) {
      return true;
    }
    if (this.line > other.line) {
      return false;
    }
    return this.character < other.character;
  }

  isAfter(other: Position): boolean {
    return !this.isBefore(other) && !this.isEqual(other);
  }
}

export class Selection extends Range {
  anchor: Position;
  active: Position;

  constructor(anchor: Position, active: Position) {
    super(anchor, active);
    this.anchor = anchor;
    this.active = active;
  }
}

export class Diagnostic {
  range: Range;
  message: string;
  severity: DiagnosticSeverity;
  source?: string;

  constructor(range: Range, message: string, severity?: DiagnosticSeverity) {
    this.range = range;
    this.message = message;
    this.severity = severity ?? DiagnosticSeverity.Error;
  }
}

export class Uri {
  static file(path: string): Uri {
    return new Uri("file", path);
  }

  static parse(value: string): Uri {
    return new Uri("file", value);
  }

  static joinPath(base: Uri, ...pathSegments: string[]): Uri {
    const newPath = base.path + "/" + pathSegments.join("/");
    return new Uri(base.scheme, newPath);
  }

  constructor(
    public scheme: string,
    public path: string,
  ) {}

  toString(): string {
    return `${this.scheme}://${this.path}`;
  }

  get fsPath(): string {
    return this.path;
  }
}

export class ThemeColor {
  constructor(public id: string) {}
}

export class ThemeIcon {
  static readonly File = new ThemeIcon("file");
  static readonly Folder = new ThemeIcon("folder");

  constructor(
    public id: string,
    public color?: ThemeColor,
  ) {}
}

export class TreeItem {
  label?: string;
  iconPath?: ThemeIcon | Uri;
  command?: { command: string; title: string; arguments?: unknown[] };
  contextValue?: string;
  tooltip?: string;
  description?: string;
  resourceUri?: Uri;
  collapsibleState?: TreeItemCollapsibleState;

  constructor(label: string, collapsibleState?: TreeItemCollapsibleState) {
    this.label = label;
    this.collapsibleState = collapsibleState;
  }
}

export class MarkdownString {
  value: string = "";
  isTrusted?: boolean;
  supportHtml?: boolean;

  constructor(value?: string) {
    if (value) {
      this.value = value;
    }
  }

  appendMarkdown(value: string): this {
    this.value += value;
    return this;
  }

  appendCodeblock(value: string, language?: string): this {
    this.value += `\`\`\`${language || ""}\n${value}\n\`\`\``;
    return this;
  }
}

export class Hover {
  contents: MarkdownString[];
  range?: Range;

  constructor(contents: MarkdownString | MarkdownString[], range?: Range) {
    this.contents = Array.isArray(contents) ? contents : [contents];
    this.range = range;
  }
}

export class CodeAction {
  title: string;
  command?: { command: string; title: string; arguments?: unknown[] };
  diagnostics?: Diagnostic[];
  isPreferred?: boolean;
  kind?: { value: string };

  constructor(title: string, kind?: { value: string }) {
    this.title = title;
    this.kind = kind;
  }
}

export const CodeActionKind = {
  QuickFix: { value: "quickfix" },
};

export class WorkspaceEdit {
  private readonly edits: Map<string, { type: string; range: Range; newText: string }[]> =
    new Map();

  replace(uri: Uri, range: Range, newText: string): void {
    if (!this.edits.has(uri.toString())) {
      this.edits.set(uri.toString(), []);
    }
    const entries = this.edits.get(uri.toString());
    if (entries) {
      entries.push({ type: "replace", range, newText });
    }
  }
}

export class EventEmitter<T> {
  private listeners: ((e: T) => void)[] = [];

  get event() {
    return (listener: (e: T) => void) => {
      this.listeners.push(listener);
      return { dispose: () => {} };
    };
  }

  fire(data: T): void {
    this.listeners.forEach((listener) => {
      listener(data);
    });
  }

  dispose(): void {
    this.listeners = [];
  }
}

// Mock workspace
export const workspace = {
  getConfiguration: vi.fn((_section?: string) => ({
    get: vi.fn((_key: string, defaultValue?: unknown) => defaultValue),
    update: vi.fn(),
    has: vi.fn(() => true),
    inspect: vi.fn(),
  })),

  openTextDocument: vi.fn((uri: Uri) =>
    Promise.resolve({
      uri,
      getText: vi.fn(() => "Test content"),
      positionAt: vi.fn((offset: number) => new Position(0, offset)),
      offsetAt: vi.fn((position: Position) => position.character),
      lineAt: vi.fn((line: number) => ({
        text: "Test line",
        range: new Range(new Position(line, 0), new Position(line, 10)),
      })),
      lineCount: 1,
      fileName: uri.path,
      languageId: "markdown",
      version: 1,
      isDirty: false,
      isClosed: false,
    }),
  ),

  applyEdit: vi.fn(() => Promise.resolve(true)),

  fs: {
    readDirectory: vi.fn(() => Promise.resolve([])),
    readFile: vi.fn(() => Promise.resolve(new Uint8Array())),
    writeFile: vi.fn(() => Promise.resolve()),
    delete: vi.fn(() => Promise.resolve()),
    createDirectory: vi.fn(() => Promise.resolve()),
  },

  workspaceFolders: [],
  textDocuments: [] as { uri: Uri; getText: ReturnType<typeof vi.fn>; languageId: string }[],

  onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
  onDidOpenTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
  onDidCloseTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
  onDidChangeTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
  onDidChangeWorkspaceFolders: vi.fn(() => ({ dispose: vi.fn() })),
};

// Mock window
export const window = {
  showInformationMessage: vi.fn(),
  showWarningMessage: vi.fn(),
  showErrorMessage: vi.fn(),
  showQuickPick: vi.fn(),
  showInputBox: vi.fn(),
  showOpenDialog: vi.fn(),
  showTextDocument: vi.fn(),

  createStatusBarItem: vi.fn(() => ({
    text: "",
    tooltip: "",
    command: "",
    backgroundColor: undefined,
    show: vi.fn(),
    hide: vi.fn(),
    dispose: vi.fn(),
  })),

  createTreeView: vi.fn(() => ({
    title: "",
    dispose: vi.fn(),
  })),

  withProgress: vi.fn(
    (_options: unknown, task: (progress: { report: ReturnType<typeof vi.fn> }) => unknown) => {
      return task({ report: vi.fn() });
    },
  ),

  activeTextEditor: undefined,

  onDidChangeActiveTextEditor: vi.fn(() => ({ dispose: vi.fn() })),
};

// Mock languages
export const languages = {
  createDiagnosticCollection: vi.fn(() => ({
    set: vi.fn(),
    delete: vi.fn(),
    clear: vi.fn(),
    forEach: vi.fn(),
    get: vi.fn(() => []),
    has: vi.fn(() => false),
    dispose: vi.fn(),
  })),

  registerCodeActionsProvider: vi.fn(() => ({ dispose: vi.fn() })),
  registerHoverProvider: vi.fn(() => ({ dispose: vi.fn() })),
};

// Mock env
export const env: { uiKind: UIKind } = {
  uiKind: UIKind.Desktop,
};

// Mock commands
export const commands = {
  registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
  executeCommand: vi.fn(),
};

// Mock ExtensionContext
export class ExtensionContext {
  subscriptions: { dispose(): void }[] = [];
  workspaceState = {
    get: vi.fn(),
    update: vi.fn(),
  };
  globalState = {
    get: vi.fn(),
    update: vi.fn(),
  };
  extensionPath = "/test/path";
  extensionUri = Uri.parse("file:///test/path");
  storagePath = "/test/storage";
  globalStoragePath = "/test/global-storage";
  logPath = "/test/logs";
}
