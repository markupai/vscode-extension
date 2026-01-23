# MarkupAI VS Code Extension - Development Setup Guide

This guide will help you set up your development environment from scratch, even if you have no prior programming experience.

---

## Table of Contents

1. [Install Required Software](#1-install-required-software)
2. [Download and Extract the Project](#2-download-and-extract-the-project)
3. [Install Dependencies](#3-install-dependencies)
4. [Open the Project](#4-open-the-project)
5. [Run the Extension](#5-run-the-extension)
6. [Configure the Extension](#6-configure-the-extension)
7. [Making Changes](#7-making-changes)
8. [Troubleshooting](#8-troubleshooting)

---

## 1. Install Required Software

### Step 1.1: Install Node.js

Node.js is the runtime that powers this extension's development tools.

**For macOS:**

1. Open your web browser and go to [https://nodejs.org](https://nodejs.org)
2. Download the **LTS (Long Term Support)** version (the green button)
3. Open the downloaded `.pkg` file
4. Follow the installation wizard, clicking "Continue" and "Agree" when prompted
5. Click "Install" and enter your Mac password if asked

**For Windows:**

1. Open your web browser and go to [https://nodejs.org](https://nodejs.org)
2. Download the **LTS (Long Term Support)** version (the green button)
3. Open the downloaded `.msi` file
4. Follow the installation wizard, accepting the license agreement
5. Keep the default settings and click "Next" until installation completes

**Verify Installation:**

1. Open Terminal (macOS) or Command Prompt (Windows)
   - **macOS**: Press `Cmd + Space`, type "Terminal", press Enter
   - **Windows**: Press `Win + R`, type "cmd", press Enter
2. Type the following command and press Enter:
   ```
   node --version
   ```
3. You should see a version number like `v20.x.x` or similar

---

### Step 1.2: Install Visual Studio Code

VS Code is the code editor we'll use for development.

1. Go to [https://code.visualstudio.com](https://code.visualstudio.com)
2. Download the version for your operating system
3. Install it by following the on-screen instructions
4. Open VS Code after installation

---

## 2. Download and Extract the Project

1. Download the project ZIP file from the shared Google Drive link

2. Locate the downloaded file (usually in your `Downloads` folder)

3. Extract the ZIP file:
   - **macOS**: Double-click the ZIP file to extract it
   - **Windows**: Right-click the ZIP file → **Extract All** → Choose a location → **Extract**

4. Move the extracted folder to a convenient location (e.g., your Documents or a Projects folder)

5. Remember where you saved it — you'll need this location in the next steps!

---

## 3. Install Dependencies

Dependencies are additional code packages that the project needs to work.

1. Open Terminal (macOS) or Command Prompt (Windows)
   - **macOS**: Press `Cmd + Space`, type "Terminal", press Enter
   - **Windows**: Press `Win + R`, type "cmd", press Enter

2. Navigate to the project folder. For example, if you extracted it to your Documents folder:

   **macOS:**

   ```bash
   cd ~/Documents/vscode-markupai
   ```

   **Windows:**

   ```bash
   cd C:\Users\YourUsername\Documents\vscode-markupai
   ```

   > Replace `YourUsername` with your actual Windows username

3. Run the following command:

   ```bash
   npm install
   ```

4. Wait for the installation to complete. You'll see progress messages and eventually return to a command prompt.

   > **What's happening?** This command reads the `package.json` file and downloads all required packages into a folder called `node_modules`.

---

## 4. Open the Project

1. Open VS Code

2. Click **File** → **Open Folder** (or **Open** on macOS)

3. Navigate to the `vscode-markupai` folder you extracted and click **Open**

4. You should see the project files in the left sidebar:
   ```
   vscode-markupai/
   ├── src/
   │   └── extension.ts    ← Main extension code
   ├── package.json        ← Project configuration
   ├── README.md
   └── ...
   ```

---

## 5. Run the Extension

### Step 5.1: Compile the Code

Before running, we need to compile (convert) the TypeScript code to JavaScript:

1. In VS Code, open the Terminal:
   - Click **Terminal** → **New Terminal** from the menu bar
   - Or press `` Ctrl + ` `` (backtick key)

2. In the terminal, type:

   ```bash
   npm run compile
   ```

3. Wait for it to finish (you should see no errors)

### Step 5.2: Launch the Extension

1. Press **F5** on your keyboard
   - Or click **Run** → **Start Debugging** from the menu

2. A new VS Code window will open. This is the **Extension Development Host** - a special VS Code instance where your extension is running.

3. In this new window:
   - Open any text file (like a `.txt` or `.md` file)
   - The MarkupAI extension should now be active!

---

## 6. Configure the Extension

### Set Up Your API Token

The extension needs an API token to communicate with MarkupAI servers.

1. In the Extension Development Host window (the one that opened when you pressed F5):

2. Press `Cmd + ,` (macOS) or `Ctrl + ,` (Windows) to open Settings

3. Search for "markupai"

4. Find **Markupai: Api Token** and enter your token

5. Alternatively, use the Command Palette:
   - Press `Cmd + Shift + P` (macOS) or `Ctrl + Shift + P` (Windows)
   - Type "MarkupAI: Configure API Token"
   - Press Enter and paste your token

---

## 7. Making Changes

### The Development Workflow

1. **Edit the code** in `src/extension.ts`

2. **Compile your changes**:

   ```bash
   npm run compile
   ```

   Or use watch mode to auto-compile on save:

   ```bash
   npm run watch
   ```

3. **Reload the extension**:
   - In the Extension Development Host window, press `Cmd + R` (macOS) or `Ctrl + R` (Windows)
   - Or close and reopen by pressing F5 again

### Key Files

| File               | Purpose                                            |
| ------------------ | -------------------------------------------------- |
| `src/extension.ts` | Main extension logic - all features are here       |
| `package.json`     | Extension metadata, commands, settings definitions |
| `README.md`        | User-facing documentation                          |

---

## 8. Troubleshooting

### "npm: command not found"

Node.js wasn't installed correctly. Reinstall Node.js and restart your terminal.

### "Cannot find module..." errors

Run `npm install` again to ensure all dependencies are installed.

### Extension not loading

1. Check the Debug Console for errors:
   - In VS Code, click **View** → **Debug Console**
2. Make sure you compiled the code with `npm run compile`

### Changes not appearing

1. Make sure you saved the file (`Cmd + S` / `Ctrl + S`)
2. Recompile: `npm run compile`
3. Reload the Extension Development Host window

### TypeScript errors during compile

Read the error message carefully. Common issues:

- Missing semicolons or brackets
- Typos in variable names
- Using a variable before defining it

---

## Quick Reference Commands

| Command           | What it does                         |
| ----------------- | ------------------------------------ |
| `npm install`     | Install all project dependencies     |
| `npm run compile` | Compile TypeScript to JavaScript     |
| `npm run watch`   | Auto-compile when files change       |
| `F5`              | Launch extension in debug mode       |
| `Cmd/Ctrl + R`    | Reload extension in development host |

---

## Getting Help

- **VS Code Extension Docs**: [https://code.visualstudio.com/api](https://code.visualstudio.com/api)
- **TypeScript Docs**: [https://www.typescriptlang.org/docs](https://www.typescriptlang.org/docs)
- **MarkupAI API Docs**: Check the `@markupai/api` package documentation

---

Happy coding! 🚀
