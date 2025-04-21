// $ code $(pwd) --extensionDevelopmentPath=$(pwd)
// $ npm run watch
// test

import * as vscode from 'vscode';
import * as path from 'path';

export function activate(context: vscode.ExtensionContext) {
  const ggViewProvider = new GGViewProvider();

  // vscode.window.registerTreeDataProvider('ggView', ggViewProvider);
  const treeView = vscode.window.createTreeView('ggView', {
    treeDataProvider: ggViewProvider,
    dragAndDropController: ggViewProvider,
    showCollapseAll: false
  });

  const refreshCommand = vscode.commands.registerCommand('gg.refresh', () => {
    ggViewProvider.refresh();
  });

  const ggUpdateBranchMapCommand = vscode.commands.registerCommand('gg.updateBranchMap', async () => {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    const extensionPath = context.extensionPath;
    if (workspaceFolders) {
      const output = await executeCommand('python3 ' + extensionPath + '/gg.py update-branch-map', workspaceFolders[0].uri.fsPath);
      console.log(output);
      ggViewProvider.refresh();
    }
  });

  const ggCommitAllCommand = vscode.commands.registerCommand('gg.commitAll', async () => {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    const extensionPath = context.extensionPath;
    if (workspaceFolders) {
      const output = await executeCommand('python3 ' + extensionPath + '/gg.py commit-all', workspaceFolders[0].uri.fsPath);
      console.log(output);
      ggViewProvider.refresh();
    }
  });

  const ggPushAllCommand = vscode.commands.registerCommand('gg.pushAll', async () => {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    const extensionPath = context.extensionPath;
    if (workspaceFolders) {
      const output = await executeCommand('python3 ' + extensionPath + '/gg.py push-all', workspaceFolders[0].uri.fsPath);
      console.log(output);
      ggViewProvider.refresh();
    }
  });  

  const openFileCommand = vscode.commands.registerCommand('gg.openFile', (fileItem: FileItem) => {
    if (fileItem) {
      const filePath = vscode.Uri.file(fileItem.filePath);
      vscode.commands.executeCommand('vscode.open', filePath);
    }
  });

  const showDiffCommand = vscode.commands.registerCommand('gg.showDiff', (fileItem: FileItem) => {
    if (fileItem) {
      const filePath = vscode.Uri.file(fileItem.filePath);
      vscode.commands.executeCommand('vscode.diff',
        filePath.with({ scheme: 'git', query: 'HEAD' }),
        filePath,
        `${path.basename(fileItem.filePath)} (Working Tree)`);
    }
  });

  context.subscriptions.push(treeView, refreshCommand, ggCommitAllCommand, ggPushAllCommand, ggUpdateBranchMapCommand, openFileCommand, showDiffCommand);
}

class FileItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly filePath: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(label, collapsibleState);
    if (filePath.length != 0) {
      // this.tooltip = this.filePath;
      // this.description = this.getFileStatus(this.filePath);
      this.iconPath = new vscode.ThemeIcon('file');
      this.command = {
        command: 'gg.openFile',
        title: 'Open File',
        arguments: [this]
      };
      this.contextValue = 'category';
    } else {
      this.contextValue = 'category';
      this.iconPath = new vscode.ThemeIcon('record', new vscode.ThemeColor('errorForeground'));
    }
  }

  private getFileStatus(filePath: string): string {
    // In a real implementation, we would determine the exact status from Git
    // For this skeleton, we'll just return a placeholder
    return 'modified';
  }
}

import * as fs from 'fs';
import { promisify } from 'util';

import * as cp from 'child_process';

/**
 * Execute a bash command in the given directory
 * @param command The command to execute
 * @param cwd The working directory
 * @returns Promise with stdout or rejects with error
 */
function executeCommand(command: string, cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // For Windows compatibility, you might want to use 'cmd.exe', ['/c', command] instead
    cp.exec(command, { cwd }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`Command failed: ${error.message}\n${stderr}`));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

// Promisify the fs.readFile function for cleaner async/await usage
const readFile = promisify(fs.readFile);

/**
 * Read the content of a file
 * @param filePath Full path to the file
 * @returns Promise with the file content as string
 */
async function readFileContent(filePath: string): Promise<string> {
  try {
    // Read the file content as a UTF-8 string
    const content = await readFile(filePath, 'utf8');
    return content;
  } catch (error) {
    // Handle potential errors
    vscode.window.showErrorMessage(`Failed to read file: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

// Example usage in your extension:
async function openAndReadFile(fileItem: FileItem): Promise<void> {
  try {
    const content = await readFileContent(fileItem.filePath);

    // You can now do something with the content, e.g.:
    // - Display it in an output channel
    // - Process it before displaying
    // - Compare with another version

    console.log(`File content length: ${content.length} characters`);

    // Alternative: Use VSCode's built-in file reading via workspace.fs
    // const fileUri = vscode.Uri.file(fileItem.filePath);
    // const contentBytes = await vscode.workspace.fs.readFile(fileUri);
    // const content = Buffer.from(contentBytes).toString('utf8');

  } catch (error) {
    console.error('Error reading file:', error);
  }
}

function parseFileIntoDict(fileContent: string): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  let currentKey: string | null = null;

  // Split the content into lines
  const lines = fileContent.split('\n');

  for (const line of lines) {
    const trimmedLine = line.trim();

    // Skip empty lines
    if (trimmedLine === '') {
      continue;
    }

    // Check if this is a section header
    if (trimmedLine.startsWith('# ')) {
      // Extract the key (removing the '# ' prefix)
      currentKey = trimmedLine.substring(2).trim();

      // Initialize an empty array for this key if it doesn't exist
      if (!result[currentKey]) {
        result[currentKey] = [];
      }
    }
    // If we have a current key and this isn't a section header, add to the current section
    else if (currentKey !== null) {
      result[currentKey].push(trimmedLine);
    }
    // If we encounter content before any section header, we could either ignore it or handle it specially
    // For now, we'll ignore it
  }

  return result;
}

function moveFile(map: Record<string, string[]>, filename: string, targetKey: string): void {
  // 1) remove from any list that contains it
  for (const key in map) {
    const idx = map[key].indexOf(filename);
    if (idx !== -1) {
      map[key].splice(idx, 1);
    }
  }

  // 2) ensure targetKey exists
  if (!map[targetKey]) {
    map[targetKey] = [];
  }

  // 3) push if not already there
  if (!map[targetKey].includes(filename)) {
    map[targetKey].push(filename);
  }
}

function linearize(map: Record<string, string[]>): string {
  const lines: string[] = [];

  for (const key of Object.keys(map)) {
    lines.push(`# ${key}`);
    for (const file of map[key]) {
      lines.push(file);
    }
    lines.push('');
  }

  return lines.join('\n');
}

async function fileExists(uri: vscode.Uri): Promise<boolean> {
  try {
      await vscode.workspace.fs.stat(uri);
      return true;
  } catch (err) {
      if (err instanceof vscode.FileSystemError && err.code === 'FileNotFound') {
          return false;
      }
      throw err; // rethrow unexpected errors
  }
}

class GGViewProvider implements vscode.TreeDataProvider<FileItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<FileItem | undefined | null | void> = new vscode.EventEmitter<FileItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<FileItem | undefined | null | void> = this._onDidChangeTreeData.event;

  // Add these properties for drag and drop
  dragMimeTypes = ['text/plain'];
  dropMimeTypes = ['text/plain'];

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: FileItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: FileItem): Promise<FileItem[]> {
    if (element) {
      // For this skeleton, we don't handle nested structures
      console.log(element);
      return await this.getFiles(element.label);
    } else {
      return await this.getFiles(null);
    }
  }

  private async getFiles(branchName: string | null): Promise<FileItem[]> {

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      return [];
    }

    const path = workspaceFolders[0].uri.fsPath;

    if (!await fileExists(vscode.Uri.file(path + "/.gg.txt"))) {
      await vscode.commands.executeCommand('gg.updateBranchMap');
    }
    
    const content = await readFileContent(path + "/.gg.txt");
    const data = parseFileIntoDict(content);
    if (branchName == null) {
      return Object.keys(data).map(key => {
        return new FileItem(key, "", vscode.TreeItemCollapsibleState.Expanded)
      });
    } else {
      return data[branchName].map(key => {
        return new FileItem(key, path + '/' + key, vscode.TreeItemCollapsibleState.None)
      });
    }
  }

  // Handle drag operations
  handleDrag(source: readonly FileItem[], dataTransfer: vscode.DataTransfer): void {
    // Only allow dragging file items, not categories
    const fileItems = source.filter(item => item.filePath != "");

    if (fileItems.length > 0) {
      const uriList = fileItems
        .map(item => item.label)
        .join('\n');
      dataTransfer.set('text/plain', new vscode.DataTransferItem(uriList.toString()));
    }
  }

  // Handle drop operations
  async handleDrop(target: FileItem | undefined, dataTransfer: vscode.DataTransfer): Promise<void> {
    // Get the dropped data
    const uriListData = dataTransfer.get('text/plain');

    if (uriListData) {
      const uriList = uriListData.value.toString().split('\n');
      console.log(uriList);

      // Check if dropping onto a category
      if (target && target.filePath == "") {
        const categoryName = target.label.toString();

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
          return;
        }
        const path = workspaceFolders[0].uri.fsPath;
        const content = await readFileContent(path + "/.gg-branch-assignment.txt");
        const data = parseFileIntoDict(content);

        
        // Process each dropped file
        for (const uri of uriList) {
          try {
            // Add the file to the category in your dictionary
            // This is just an example - adapt to your data structure
            // const fileName = path.basename(uri.fsPath);
            console.log('Adding %s to %s', uri, target.label);
            moveFile(data, uri, target.label);
            
            // You might want to write this back to your categories file
            // await this.saveDictionary();
          } catch (error) {
            vscode.window.showErrorMessage(`Error processing dropped file: ${error instanceof Error ? error.message : String(error)}`);
          }
        }

        console.log(data);

        try {
          await fs.writeFile(path + "/.gg-branch-assignment.txt", linearize(data), () => {});
          console.log('Wrote it.');
        } catch (err) {
          console.error('Failed to write file', err);
        }

        // Refresh the view to show the changes
        this.refresh();
      } else {
        vscode.window.showInformationMessage('Please drop onto a category to add files.');
      }
    }
  }
}

export function deactivate() { }