# MarkupAI VSCode Extension

## Features

### 🔍 Real-time Content Analysis

- Automatically checks your documents with the MarkupAI Style Agent
- Underlines issues directly in the editor with high / medium / low risk levels
- Shows a risk summary (or quality score, when enabled) in the status bar

### 💡 Smart Suggestions

- Hover over underlined issues to see detailed explanations
- One-click "Apply Fix" to instantly correct issues
- Quick-fix actions available via the lightbulb menu (Ctrl+. / Cmd+.)

### 📊 Risk Assessment

- View the risk summary for the current document in the status bar (e.g. `2H 3M 11L`)
- Click it for a detailed breakdown by risk level
- Organizations with numeric scoring enabled also see a quality score (0–100)

### 📁 Folder Scanner (NEW!)

- Check multiple documents in a folder at once
- Select specific files or check all files in a folder
- View results in a tree structure with quality scores
- Perfect for auditing entire documentation folders
- [Learn more about Folder Scanner](FOLDER_SCANNER.md)

### ⚙️ Configurable

- Select any style guide from your organization, or use the organization default
- Enable/disable checking on file open or on content change
- Easily toggle MarkupAI issues on/off via context menu

## Getting Started

### 1. Install the Extension

Install from the VS Code Marketplace or build from source.

### 2. Sign In

1. Click the "MarkupAI: Sign in" prompt in the status bar, or run `MarkupAI: Sign In` from the Command Palette (Ctrl+Shift+P / Cmd+Shift+P)
2. Choose **Sign in with browser** — complete the sign-in at markup.ai and return to VS Code
3. Alternatively, choose **Paste access token or API key** to use a token obtained elsewhere

### 3. Start Writing

Open any text document and MarkupAI will automatically analyze your content!

## Commands

| Command                           | Description                               |
| --------------------------------- | ----------------------------------------- |
| `Markup AI: Check Content`        | Manually trigger a content check          |
| `Markup AI: Sign In`              | Sign in via browser or paste a token      |
| `Markup AI: Sign Out`             | Sign out and clear the stored session     |
| `Markup AI: Select Style Guide`   | Choose a style guide for content analysis |
| `Markup AI: Show Content Scores`  | View the risk assessment breakdown        |
| `MarkupAI: Toggle Enable/Disable` | Enable or disable the extension           |
| `MarkupAI: Select Folder to Scan` | Choose a folder to check multiple files   |
| `MarkupAI: Check All Files`       | Check all files in selected folder        |
| `MarkupAI: Check Selected Files`  | Check only selected files in folder       |

## Context Menu

Right-click in any editor to access:

- **MarkupAI - Check Content**: Run a manual content check
- **MarkupAI - Disable/Enable Issues**: Quickly toggle issue visibility

## Configuration

Access settings via `File > Preferences > Settings` and search for "MarkupAI":

| Setting                  | Description                                                   | Default |
| ------------------------ | ------------------------------------------------------------- | ------- |
| `markupai.enabled`       | Enable/disable Markup AI checking                             | `true`  |
| `markupai.styleGuide`    | Style guide ID (empty = organization default; use the picker) | `""`    |
| `markupai.environment`   | API environment (`prod` or `dev`)                             | `prod`  |
| `markupai.checkOnOpen`   | Automatically check when a file is opened                     | `true`  |
| `markupai.checkOnChange` | Automatically check when content changes                      | `false` |
| `markupai.checkDelay`    | Delay (ms) before checking after a change                     | `2000`  |

Sign-in tokens are stored securely in VS Code Secret Storage, not in settings.

## Issue Severity Levels

Issues are highlighted with different colors based on severity:

- 🔴 **Error** (red underline): High risk issues
- 🟡 **Warning** (yellow underline): Medium risk issues
- 🔵 **Information** (blue underline): Low risk suggestions

## Requirements

- VS Code 1.120.0 or higher (Desktop or Remote)
- A MarkupAI account ([markup.ai](https://markup.ai))

## Platform Support

- ✅ **VS Code Desktop** (Windows, macOS, Linux)
- ✅ **Remote Development** (SSH, Containers, WSL)
- ✅ **Virtual Workspaces** (Cloud storage, read-only folders)
- 🚧 **VS Code for Web** — not yet available (see below)

### Web Compatibility

The extension codebase is web-compatible — no Node.js built-in modules are used, and all file operations go through VS Code's `workspace.fs` API. A browser-targeted bundle is built and validated in CI to prevent regressions.

However, the extension currently **works on desktop only** because the MarkupAI API does not yet allow browser CORS requests from the web extension host. Once the API CORS allowlist is updated, the existing web bundle (wired up via the `browser` entry in `package.json`) will work as-is.

## Testing

This extension has comprehensive test coverage using Vitest:

```bash
# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Interactive test UI
npm run test:ui
```

**Coverage**: 90%+ across all modules

See [TESTING.md](TESTING.md) for detailed testing guide.

## Development

```bash
# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Run tests
npm test

# Run linter
npm run lint:check

# Package extension
npm run package

# Validate web compatibility
npx @vscode/vsce package --target web --out dist/web.vsix
```

### CI/CD Pipeline

The GitHub Actions workflow (`build.yml`) runs the following checks on every push and pull request:

1. **Code formatting** — `prettier --check`
2. **Type checking** — `tsc --noEmit`
3. **Linting** — `eslint`
4. **Compile** — esbuild bundles for desktop (Node.js) and web (browser)
5. **Tests** — `vitest` with coverage
6. **SonarQube scan** — static analysis
7. **Web bundle verification** — ensures the browser-targeted bundle builds successfully (catches accidental Node.js imports)
8. **Package** — produces the desktop VSIX artifact

## Support

For issues, feature requests, or questions, please visit the [MarkupAI documentation](https://docs.markup.ai) or contact support.
