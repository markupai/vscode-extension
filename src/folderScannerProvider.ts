import * as vscode from "vscode";
import { DocumentAssessment, FolderScannerItem } from "./types";
import { SUPPORTED_FILE_EXTENSIONS } from "./constants";
import { formatRiskSummary, getLeadSeverity, getScoreEmoji, getSeverityEmoji } from "./utils";

const IGNORED_DIRECTORIES = new Set(["node_modules", "dist", "build"]);

function shouldSkipEntry(name: string): boolean {
  return name.startsWith(".") || IGNORED_DIRECTORIES.has(name);
}

/**
 * Provides tree data for the Folder Scanner panel.
 * Discovers and lists supported document files for bulk checking.
 */
export class FolderScannerTreeDataProvider implements vscode.TreeDataProvider<FolderScannerItem> {
  private readonly _onDidChangeTreeData: vscode.EventEmitter<FolderScannerItem | undefined | null> =
    new vscode.EventEmitter<FolderScannerItem | undefined | null>();
  readonly onDidChangeTreeData: vscode.Event<FolderScannerItem | undefined | null> =
    this._onDidChangeTreeData.event;

  private rootFolder: vscode.Uri | null = null;
  private readonly selectedFiles: Set<string> = new Set();

  constructor(private readonly getDocumentAssessments: () => Map<string, DocumentAssessment>) {
    this.initializeFromWorkspace();
  }

  initializeFromWorkspace(): boolean {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    console.log("MarkupAI: Workspace folders:", workspaceFolders);

    if (workspaceFolders && workspaceFolders.length > 0) {
      this.rootFolder = workspaceFolders[0].uri;
      this.selectedFiles.clear();
      console.log("MarkupAI: Folder scanner initialized with:", this.rootFolder.fsPath);
      return true;
    }

    console.log("MarkupAI: No workspace folder found");
    return false;
  }

  hasFolder(): boolean {
    return this.rootFolder !== null;
  }

  getRootFolder(): vscode.Uri | null {
    return this.rootFolder;
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  setRootFolder(folder: vscode.Uri): void {
    this.rootFolder = folder;
    this.selectedFiles.clear();
    this.refresh();
  }

  toggleFileSelection(item: FolderScannerItem): void {
    const uriString = item.uri.toString();
    if (this.selectedFiles.has(uriString)) {
      this.selectedFiles.delete(uriString);
    } else {
      this.selectedFiles.add(uriString);
    }
    this.refresh();
  }

  selectAll(): void {
    if (!this.rootFolder) {
      return;
    }
    void this.getAllFiles().then((files) => {
      files.forEach((file) => this.selectedFiles.add(file.toString()));
      this.refresh();
    });
  }

  deselectAll(): void {
    this.selectedFiles.clear();
    this.refresh();
  }

  getSelectedFiles(): vscode.Uri[] {
    return Array.from(this.selectedFiles).map((uriString) => vscode.Uri.parse(uriString));
  }

  async getAllFiles(): Promise<vscode.Uri[]> {
    if (!this.rootFolder) {
      return [];
    }
    const files: vscode.Uri[] = [];
    await this.collectFiles(this.rootFolder, files);
    return files;
  }

  private async collectFiles(folder: vscode.Uri, files: vscode.Uri[]): Promise<void> {
    try {
      const entries = await vscode.workspace.fs.readDirectory(folder);

      for (const [name, type] of entries) {
        if (shouldSkipEntry(name)) {
          continue;
        }

        const uri = vscode.Uri.joinPath(folder, name);

        if (type === vscode.FileType.Directory) {
          await this.collectFiles(uri, files);
        } else if (type === vscode.FileType.File) {
          if (SUPPORTED_FILE_EXTENSIONS.some((ext) => name.endsWith(ext))) {
            files.push(uri);
          }
        }
      }
    } catch (error) {
      console.error(`Error reading directory ${folder.fsPath}:`, error);
    }
  }

  getTreeItem(element: FolderScannerItem): vscode.TreeItem {
    const treeItem = new vscode.TreeItem(
      element.label,
      element.type === "folder"
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.None,
    );

    if (element.type === "folder") {
      treeItem.iconPath = vscode.ThemeIcon.Folder;
      treeItem.contextValue = "folder";
    } else {
      const isSelected = this.selectedFiles.has(element.uri.toString());
      treeItem.iconPath = new vscode.ThemeIcon(isSelected ? "check" : "circle-outline");
      treeItem.contextValue = "file";
      treeItem.resourceUri = element.uri;

      const docKey = element.uri.toString();
      const assessment = this.getDocumentAssessments().get(docKey);
      if (assessment) {
        treeItem.description = describeAssessment(assessment);
      }

      treeItem.command = {
        command: "markupai.openFile",
        title: "Open File",
        arguments: [element.uri],
      };
    }

    return treeItem;
  }

  async getChildren(element?: FolderScannerItem): Promise<FolderScannerItem[]> {
    if (!this.rootFolder) {
      const initialized = this.initializeFromWorkspace();
      if (!initialized) {
        return [];
      }
    }

    if (!element) {
      return this.getFolderContents(this.rootFolder);
    } else if (element.type === "folder") {
      return this.getFolderContents(element.uri);
    }

    return [];
  }

  private async getFolderContents(folder: vscode.Uri | null): Promise<FolderScannerItem[]> {
    if (folder === null) {
      return [];
    }
    const items: FolderScannerItem[] = [];

    try {
      const entries = await vscode.workspace.fs.readDirectory(folder);

      const folders: [string, vscode.FileType][] = [];
      const files: [string, vscode.FileType][] = [];

      for (const entry of entries) {
        const [name] = entry;
        if (shouldSkipEntry(name)) {
          continue;
        }

        if (entry[1] === vscode.FileType.Directory) {
          folders.push(entry);
        } else if (entry[1] === vscode.FileType.File) {
          if (SUPPORTED_FILE_EXTENSIONS.some((ext) => name.endsWith(ext))) {
            files.push(entry);
          }
        }
      }

      for (const [name] of folders) {
        const uri = vscode.Uri.joinPath(folder, name);
        items.push({
          type: "folder",
          uri: uri,
          label: name,
          isSelected: false,
        });
      }

      for (const [name] of files) {
        const uri = vscode.Uri.joinPath(folder, name);
        const isSelected = this.selectedFiles.has(uri.toString());
        items.push({
          type: "file",
          uri: uri,
          label: name,
          isSelected: isSelected,
        });
      }
    } catch (error) {
      console.error(`Error reading directory ${folder.fsPath}:`, error);
    }

    return items;
  }
}

function describeAssessment(assessment: DocumentAssessment): string {
  if (typeof assessment.score === "number") {
    return `${getScoreEmoji(assessment.score)} ${String(assessment.score)}`;
  }
  const { risk } = assessment;
  if (risk.total === 0) {
    return "✅";
  }
  return `${getSeverityEmoji(getLeadSeverity(risk))} ${formatRiskSummary(risk)}`;
}
