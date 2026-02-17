import { describe, it, expect, beforeEach, vi } from "vitest";
import * as vscode from "vscode";
import { FolderScannerTreeDataProvider } from "../src/folderScannerProvider";
import { ContentScores, FolderScannerItem } from "../src/types";

// eslint-disable-next-line @typescript-eslint/unbound-method
const mockReadDirectory = vscode.workspace.fs.readDirectory;

describe("FolderScannerTreeDataProvider", () => {
  let provider: FolderScannerTreeDataProvider;
  let scoresMap: Map<string, ContentScores>;

  beforeEach(() => {
    scoresMap = new Map();
    // Mock workspace with no folders to avoid constructor side effects
    vi.mocked(vscode.workspace).workspaceFolders = undefined;
    provider = new FolderScannerTreeDataProvider(() => scoresMap);
  });

  describe("initializeFromWorkspace", () => {
    it("should return true when workspace folders exist", () => {
      const mockUri = vscode.Uri.file("/workspace");
      vi.mocked(vscode.workspace).workspaceFolders = [
        { uri: mockUri, name: "workspace", index: 0 },
      ] as unknown as readonly vscode.WorkspaceFolder[];

      const result = provider.initializeFromWorkspace();

      expect(result).toBe(true);
      expect(provider.hasFolder()).toBe(true);
      expect(provider.getRootFolder()?.path).toBe(mockUri.path);
    });

    it("should return false when no workspace folders", () => {
      vi.mocked(vscode.workspace).workspaceFolders = undefined;

      const result = provider.initializeFromWorkspace();

      expect(result).toBe(false);
      expect(provider.hasFolder()).toBe(false);
    });

    it("should return false for empty workspace folders array", () => {
      vi.mocked(vscode.workspace).workspaceFolders =
        [] as unknown as readonly vscode.WorkspaceFolder[];

      const result = provider.initializeFromWorkspace();

      expect(result).toBe(false);
    });
  });

  describe("hasFolder / getRootFolder", () => {
    it("should return false when no folder set", () => {
      expect(provider.hasFolder()).toBe(false);
      expect(provider.getRootFolder()).toBeNull();
    });

    it("should return true after setting root folder", () => {
      const folder = vscode.Uri.file("/my/project");
      provider.setRootFolder(folder);

      expect(provider.hasFolder()).toBe(true);
      expect(provider.getRootFolder()?.path).toBe(folder.path);
    });
  });

  describe("setRootFolder", () => {
    it("should clear selected files when root folder changes", () => {
      const folder1 = vscode.Uri.file("/project1");
      provider.setRootFolder(folder1);

      const fileItem: FolderScannerItem = {
        type: "file",
        uri: vscode.Uri.file("/project1/readme.md"),
        label: "readme.md",
        isSelected: false,
      };
      provider.toggleFileSelection(fileItem);
      expect(provider.getSelectedFiles()).toHaveLength(1);

      const folder2 = vscode.Uri.file("/project2");
      provider.setRootFolder(folder2);

      expect(provider.getSelectedFiles()).toHaveLength(0);
    });
  });

  describe("toggleFileSelection", () => {
    it("should select an unselected file", () => {
      const item: FolderScannerItem = {
        type: "file",
        uri: vscode.Uri.file("/test/readme.md"),
        label: "readme.md",
        isSelected: false,
      };

      provider.toggleFileSelection(item);

      expect(provider.getSelectedFiles()).toHaveLength(1);
    });

    it("should deselect a selected file", () => {
      const item: FolderScannerItem = {
        type: "file",
        uri: vscode.Uri.file("/test/readme.md"),
        label: "readme.md",
        isSelected: false,
      };

      provider.toggleFileSelection(item);
      provider.toggleFileSelection(item);

      expect(provider.getSelectedFiles()).toHaveLength(0);
    });
  });

  describe("deselectAll", () => {
    it("should clear all selections", () => {
      const item1: FolderScannerItem = {
        type: "file",
        uri: vscode.Uri.file("/test/a.md"),
        label: "a.md",
        isSelected: false,
      };
      const item2: FolderScannerItem = {
        type: "file",
        uri: vscode.Uri.file("/test/b.md"),
        label: "b.md",
        isSelected: false,
      };

      provider.toggleFileSelection(item1);
      provider.toggleFileSelection(item2);
      expect(provider.getSelectedFiles()).toHaveLength(2);

      provider.deselectAll();
      expect(provider.getSelectedFiles()).toHaveLength(0);
    });
  });

  describe("getTreeItem", () => {
    it("should return expanded item for folder", () => {
      const element: FolderScannerItem = {
        type: "folder",
        uri: vscode.Uri.file("/test/docs"),
        label: "docs",
        isSelected: false,
      };

      const treeItem = provider.getTreeItem(element);

      expect(treeItem.label).toBe("docs");
      expect(treeItem.collapsibleState).toBe(vscode.TreeItemCollapsibleState.Expanded);
      expect(treeItem.contextValue).toBe("folder");
    });

    it("should return non-collapsible item for file", () => {
      const element: FolderScannerItem = {
        type: "file",
        uri: vscode.Uri.file("/test/readme.md"),
        label: "readme.md",
        isSelected: false,
      };

      const treeItem = provider.getTreeItem(element);

      expect(treeItem.label).toBe("readme.md");
      expect(treeItem.collapsibleState).toBe(vscode.TreeItemCollapsibleState.None);
      expect(treeItem.contextValue).toBe("file");
    });

    it("should show check icon for selected file", () => {
      const item: FolderScannerItem = {
        type: "file",
        uri: vscode.Uri.file("/test/readme.md"),
        label: "readme.md",
        isSelected: false,
      };

      provider.toggleFileSelection(item);
      const treeItem = provider.getTreeItem(item);
      const icon = treeItem.iconPath as vscode.ThemeIcon;

      expect(icon.id).toBe("check");
    });

    it("should show circle-outline icon for unselected file", () => {
      const item: FolderScannerItem = {
        type: "file",
        uri: vscode.Uri.file("/test/readme.md"),
        label: "readme.md",
        isSelected: false,
      };

      const treeItem = provider.getTreeItem(item);
      const icon = treeItem.iconPath as vscode.ThemeIcon;

      expect(icon.id).toBe("circle-outline");
    });

    it("should show score when available", () => {
      const fileUri = vscode.Uri.file("/test/readme.md");
      scoresMap.set(fileUri.toString(), {
        overall: 95,
        grammar: 90,
        consistency: 100,
        terminology: 95,
      });

      const item: FolderScannerItem = {
        type: "file",
        uri: fileUri,
        label: "readme.md",
        isSelected: false,
      };

      const treeItem = provider.getTreeItem(item);

      expect(treeItem.description).toContain("95");
      expect(treeItem.description).toContain("🟢");
    });

    it("should include openFile command for files", () => {
      const fileUri = vscode.Uri.file("/test/readme.md");
      const item: FolderScannerItem = {
        type: "file",
        uri: fileUri,
        label: "readme.md",
        isSelected: false,
      };

      const treeItem = provider.getTreeItem(item);

      expect(treeItem.command?.command).toBe("markupai.openFile");
      expect(treeItem.command?.arguments).toEqual([fileUri]);
    });
  });

  describe("getChildren", () => {
    it("should return empty array when no folder is set", async () => {
      const children = await provider.getChildren();

      expect(children).toEqual([]);
    });

    it("should return folder contents for root when folder is set", async () => {
      const folder = vscode.Uri.file("/project");
      provider.setRootFolder(folder);

      vi.mocked(mockReadDirectory).mockResolvedValue([
        ["docs", vscode.FileType.Directory],
        ["readme.md", vscode.FileType.File],
        ["script.js", vscode.FileType.File],
      ] as [string, vscode.FileType][]);

      const children = await provider.getChildren();

      // Only .md files should appear (script.js is not a supported extension)
      const folders = children.filter((c) => c.type === "folder");
      const files = children.filter((c) => c.type === "file");

      expect(folders).toHaveLength(1);
      expect(folders[0].label).toBe("docs");
      expect(files).toHaveLength(1);
      expect(files[0].label).toBe("readme.md");
    });

    it("should skip hidden files and directories", async () => {
      const folder = vscode.Uri.file("/project");
      provider.setRootFolder(folder);

      vi.mocked(mockReadDirectory).mockResolvedValue([
        [".git", vscode.FileType.Directory],
        [".hidden.md", vscode.FileType.File],
        ["visible.md", vscode.FileType.File],
      ] as [string, vscode.FileType][]);

      const children = await provider.getChildren();

      expect(children).toHaveLength(1);
      expect(children[0].label).toBe("visible.md");
    });

    it("should skip node_modules, dist, and build directories", async () => {
      const folder = vscode.Uri.file("/project");
      provider.setRootFolder(folder);

      vi.mocked(mockReadDirectory).mockResolvedValue([
        ["node_modules", vscode.FileType.Directory],
        ["dist", vscode.FileType.Directory],
        ["build", vscode.FileType.Directory],
        ["src", vscode.FileType.Directory],
      ] as [string, vscode.FileType][]);

      const children = await provider.getChildren();

      expect(children).toHaveLength(1);
      expect(children[0].label).toBe("src");
    });

    it("should return folder contents for child folder element", async () => {
      const folder = vscode.Uri.file("/project");
      provider.setRootFolder(folder);

      vi.mocked(mockReadDirectory).mockResolvedValue([["guide.md", vscode.FileType.File]] as [
        string,
        vscode.FileType,
      ][]);

      const folderElement: FolderScannerItem = {
        type: "folder",
        uri: vscode.Uri.file("/project/docs"),
        label: "docs",
        isSelected: false,
      };

      const children = await provider.getChildren(folderElement);

      expect(children).toHaveLength(1);
      expect(children[0].label).toBe("guide.md");
    });

    it("should return empty for file element", async () => {
      const fileElement: FolderScannerItem = {
        type: "file",
        uri: vscode.Uri.file("/project/readme.md"),
        label: "readme.md",
        isSelected: false,
      };

      const children = await provider.getChildren(fileElement);
      expect(children).toEqual([]);
    });
  });

  describe("getAllFiles", () => {
    it("should return empty array when no folder set", async () => {
      const files = await provider.getAllFiles();
      expect(files).toEqual([]);
    });

    it("should collect supported files recursively", async () => {
      const folder = vscode.Uri.file("/project");
      provider.setRootFolder(folder);

      vi.mocked(mockReadDirectory)
        .mockResolvedValueOnce([
          ["docs", vscode.FileType.Directory],
          ["readme.md", vscode.FileType.File],
        ] as [string, vscode.FileType][])
        .mockResolvedValueOnce([["guide.txt", vscode.FileType.File]] as [
          string,
          vscode.FileType,
        ][]);

      const files = await provider.getAllFiles();

      expect(files).toHaveLength(2);
    });
  });

  describe("refresh", () => {
    it("should fire onDidChangeTreeData event", () => {
      const listener = vi.fn();
      provider.onDidChangeTreeData(listener);

      provider.refresh();

      expect(listener).toHaveBeenCalledWith(undefined);
    });
  });
});
