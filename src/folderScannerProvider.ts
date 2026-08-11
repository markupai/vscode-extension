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

  constructor(
    private readonly getDocumentAssessments: () => Map<string, DocumentAssessment>,
    private readonly isSignedIn: () => boolean = () => true,
  ) {
    this.initializeFromWorkspace();
  }

  initializeFromWorkspace(): boolean {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    console.log("Markup AI: Workspace folders:", workspaceFolders);

    if (workspaceFolders && workspaceFolders.length > 0) {
      this.rootFolder = workspaceFolders[0].uri;
      this.selectedFiles.clear();
      console.log("Markup AI: Folder scanner initialized with:", this.rootFolder.fsPath);
      return true;
    }

    console.log("Markup AI: No workspace folder found");
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

  /**
   * Applies checkbox changes from the tree view. Checking a folder selects
   * every supported file beneath it (including files in subtrees the view
   * has not rendered), which is why the view uses
   * `manageCheckboxStateManually` instead of VS Code's own propagation.
   */
  async handleCheckboxChange(
    items: readonly [FolderScannerItem, vscode.TreeItemCheckboxState][],
  ): Promise<void> {
    for (const [item, state] of items) {
      const checked = state === vscode.TreeItemCheckboxState.Checked;
      if (item.type === "folder") {
        const files: vscode.Uri[] = [];
        await this.collectFiles(item.uri, files);
        for (const file of files) {
          this.applySelection(file, checked);
        }
      } else {
        this.applySelection(item.uri, checked);
      }
    }
    this.refresh();
  }

  private applySelection(uri: vscode.Uri, selected: boolean): void {
    if (selected) {
      this.selectedFiles.add(uri.toString());
    } else {
      this.selectedFiles.delete(uri.toString());
    }
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

  /** A folder counts as selected when it has files and all of them are selected. */
  private async isFolderFullySelected(folder: vscode.Uri): Promise<boolean> {
    if (this.selectedFiles.size === 0) {
      return false;
    }
    const files: vscode.Uri[] = [];
    await this.collectFiles(folder, files);
    return files.length > 0 && files.every((file) => this.selectedFiles.has(file.toString()));
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
      treeItem.checkboxState = element.isSelected
        ? vscode.TreeItemCheckboxState.Checked
        : vscode.TreeItemCheckboxState.Unchecked;
    } else {
      const isSelected = this.selectedFiles.has(element.uri.toString());
      treeItem.checkboxState = isSelected
        ? vscode.TreeItemCheckboxState.Checked
        : vscode.TreeItemCheckboxState.Unchecked;
      treeItem.contextValue = "file";
      // resourceUri (with no iconPath override) gives the native file icon.
      treeItem.resourceUri = element.uri;

      const docKey = element.uri.toString();
      const assessment = this.getDocumentAssessments().get(docKey);
      if (assessment) {
        treeItem.description = describeAssessment(assessment);
      }

      treeItem.command = {
        command: "markupai-lint.openFile",
        title: "Open File",
        arguments: [element.uri],
      };
    }

    return treeItem;
  }

  async getChildren(element?: FolderScannerItem): Promise<FolderScannerItem[]> {
    // An empty tree lets the signed-out viewsWelcome (with its Sign In
    // button) render instead of a folder listing the user can't check yet.
    if (!this.isSignedIn()) {
      return [];
    }

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
          isSelected: await this.isFolderFullySelected(uri),
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
