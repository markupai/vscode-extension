import { describe, it, expect, beforeEach, vi } from "vitest";
import * as vscode from "vscode";
import { FolderScannerTreeDataProvider } from "../src/folderScannerProvider";
import { DocumentAssessment, FolderScannerItem } from "../src/types";

// eslint-disable-next-line @typescript-eslint/unbound-method
const mockReadDirectory = vscode.workspace.fs.readDirectory;

describe("FolderScannerTreeDataProvider", () => {
  let provider: FolderScannerTreeDataProvider;
  let assessmentsMap: Map<string, DocumentAssessment>;

  beforeEach(() => {
    assessmentsMap = new Map();
    // Mock workspace with no folders to avoid constructor side effects
    vi.mocked(vscode.workspace).workspaceFolders = undefined;
    provider = new FolderScannerTreeDataProvider(() => assessmentsMap);
  });

  describe("initializeFromWorkspace", () => {
    it("should return true when workspace folders exist", () => {
      const mockUri = vscode.Uri.file("/workspace");
      vi.mocked(vscode.workspace).workspaceFolders = [
        { uri: mockUri, name: "workspace", index: 0 },
      ];

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
      vi.mocked(vscode.workspace).workspaceFolders = [];

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

  function fileItem(path: string): FolderScannerItem {
    return {
      type: "file",
      uri: vscode.Uri.file(path),
      label: path.split("/").pop() ?? path,
      isSelected: false,
    };
  }

  async function check(item: FolderScannerItem): Promise<void> {
    await provider.handleCheckboxChange([[item, vscode.TreeItemCheckboxState.Checked]]);
  }

  async function uncheck(item: FolderScannerItem): Promise<void> {
    await provider.handleCheckboxChange([[item, vscode.TreeItemCheckboxState.Unchecked]]);
  }

  describe("setRootFolder", () => {
    it("should clear selected files when root folder changes", async () => {
      const folder1 = vscode.Uri.file("/project1");
      provider.setRootFolder(folder1);

      await check(fileItem("/project1/readme.md"));
      expect(provider.getSelectedFiles()).toHaveLength(1);

      const folder2 = vscode.Uri.file("/project2");
      provider.setRootFolder(folder2);

      expect(provider.getSelectedFiles()).toHaveLength(0);
    });
  });

  describe("handleCheckboxChange", () => {
    it("should select a file when its checkbox is checked", async () => {
      await check(fileItem("/test/readme.md"));

      expect(provider.getSelectedFiles()).toHaveLength(1);
    });

    it("should deselect a file when its checkbox is unchecked", async () => {
      const item = fileItem("/test/readme.md");

      await check(item);
      await uncheck(item);

      expect(provider.getSelectedFiles()).toHaveLength(0);
    });

    it("should select all supported descendant files when a folder is checked", async () => {
      vi.mocked(mockReadDirectory)
        .mockResolvedValueOnce([
          ["nested", vscode.FileType.Directory],
          ["readme.md", vscode.FileType.File],
          ["script.js", vscode.FileType.File],
        ] as [string, vscode.FileType][])
        .mockResolvedValueOnce([["guide.txt", vscode.FileType.File]] as [
          string,
          vscode.FileType,
        ][]);

      const folderElement: FolderScannerItem = {
        type: "folder",
        uri: vscode.Uri.file("/project/docs"),
        label: "docs",
        isSelected: false,
      };
      await check(folderElement);

      // The Uri mock's parse() keeps the full uri string in `path`.
      const selected = provider.getSelectedFiles().map((uri) => uri.path);
      expect(selected).toHaveLength(2);
      expect(selected).toContain(vscode.Uri.file("/project/docs/readme.md").toString());
      expect(selected).toContain(vscode.Uri.file("/project/docs/nested/guide.txt").toString());
    });

    it("should deselect all descendant files when a folder is unchecked", async () => {
      await check(fileItem("/project/docs/readme.md"));
      await check(fileItem("/project/other.md"));

      vi.mocked(mockReadDirectory).mockResolvedValue([["readme.md", vscode.FileType.File]] as [
        string,
        vscode.FileType,
      ][]);

      const folderElement: FolderScannerItem = {
        type: "folder",
        uri: vscode.Uri.file("/project/docs"),
        label: "docs",
        isSelected: true,
      };
      await uncheck(folderElement);

      const selected = provider.getSelectedFiles().map((uri) => uri.path);
      expect(selected).toEqual([vscode.Uri.file("/project/other.md").toString()]);
    });

    it("should fire a refresh after applying changes", async () => {
      const listener = vi.fn();
      provider.onDidChangeTreeData(listener);

      await check(fileItem("/test/readme.md"));

      expect(listener).toHaveBeenCalledWith(undefined);
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

    it("should show a checked checkbox for a selected file", async () => {
      const item = fileItem("/test/readme.md");

      await check(item);
      const treeItem = provider.getTreeItem(item);

      expect(treeItem.checkboxState).toBe(vscode.TreeItemCheckboxState.Checked);
    });

    it("should show an unchecked checkbox and the native file icon for an unselected file", () => {
      const item = fileItem("/test/readme.md");

      const treeItem = provider.getTreeItem(item);

      expect(treeItem.checkboxState).toBe(vscode.TreeItemCheckboxState.Unchecked);
      // No iconPath override: resourceUri drives the file-type icon.
      expect(treeItem.iconPath).toBeUndefined();
      expect(treeItem.resourceUri?.path).toBe("/test/readme.md");
    });

    it("should mirror folder selection state into the folder checkbox", () => {
      const folderElement: FolderScannerItem = {
        type: "folder",
        uri: vscode.Uri.file("/test/docs"),
        label: "docs",
        isSelected: true,
      };

      const treeItem = provider.getTreeItem(folderElement);

      expect(treeItem.checkboxState).toBe(vscode.TreeItemCheckboxState.Checked);
    });

    it("should show score when available", () => {
      const fileUri = vscode.Uri.file("/test/readme.md");
      assessmentsMap.set(fileUri.toString(), {
        risk: { high: 0, medium: 1, low: 2, total: 3 },
        score: 95,
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

    it("should show check mark when there is no score and zero issues", () => {
      const fileUri = vscode.Uri.file("/test/readme.md");
      assessmentsMap.set(fileUri.toString(), {
        risk: { high: 0, medium: 0, low: 0, total: 0 },
      });

      const item: FolderScannerItem = {
        type: "file",
        uri: fileUri,
        label: "readme.md",
        isSelected: false,
      };

      const treeItem = provider.getTreeItem(item);

      expect(treeItem.description).toBe("✅");
    });

    it("should show risk summary when there is no score and issues exist", () => {
      const fileUri = vscode.Uri.file("/test/readme.md");
      assessmentsMap.set(fileUri.toString(), {
        risk: { high: 2, medium: 3, low: 11, total: 16 },
      });

      const item: FolderScannerItem = {
        type: "file",
        uri: fileUri,
        label: "readme.md",
        isSelected: false,
      };

      const treeItem = provider.getTreeItem(item);

      expect(treeItem.description).toBe("🔴 2H 3M 11L");
    });

    it("should not set a description when no assessment exists", () => {
      const item: FolderScannerItem = {
        type: "file",
        uri: vscode.Uri.file("/test/readme.md"),
        label: "readme.md",
        isSelected: false,
      };

      const treeItem = provider.getTreeItem(item);

      expect(treeItem.description).toBeUndefined();
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

      expect(treeItem.command?.command).toBe("markupai-lint.openFile");
      expect(treeItem.command?.arguments).toEqual([fileUri]);
    });
  });

  describe("getChildren", () => {
    it("should return empty array when no folder is set", async () => {
      const children = await provider.getChildren();

      expect(children).toEqual([]);
    });

    it("should return empty array when signed out so the welcome view renders", async () => {
      const signedOutProvider = new FolderScannerTreeDataProvider(
        () => assessmentsMap,
        () => false,
      );
      signedOutProvider.setRootFolder(vscode.Uri.file("/project"));

      vi.mocked(mockReadDirectory).mockResolvedValue([["readme.md", vscode.FileType.File]] as [
        string,
        vscode.FileType,
      ][]);

      expect(await signedOutProvider.getChildren()).toEqual([]);
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
