# MarkupAI VSCode Extension

## Features

### 🔍 Real-time Content Analysis

- Automatically checks your documents for grammar, spelling, consistency, and terminology issues
- Underlines issues directly in the editor with different severity levels
- Shows detailed scores in the status bar

### 💡 Smart Suggestions

- Hover over underlined issues to see detailed explanations
- One-click "Apply Fix" to instantly correct issues
- Quick-fix actions available via the lightbulb menu (Ctrl+. / Cmd+.)

### 📊 Content Quality Scores

- View overall content quality score in the status bar
- Click the score to see detailed breakdown:
  - Grammar score
  - Consistency score
  - Terminology score

### 📁 Folder Scanner (NEW!)

- Check multiple documents in a folder at once
- Select specific files or check all files in a folder
- View results in a tree structure with quality scores
- Perfect for auditing entire documentation folders
- [Learn more about Folder Scanner](FOLDER_SCANNER.md)

### ⚙️ Configurable

- Choose your preferred English dialect (American, British, Canadian)
- Select from built-in style guides (AP, Chicago, Microsoft) or use custom style guides
- Enable/disable checking on file open or on content change
- Easily toggle MarkupAI issues on/off via context menu

## Getting Started

### 1. Install the Extension

Install from the VS Code Marketplace or build from source.

### 2. Configure Your API Token

1. Get your API token from [MarkupAI](https://markup.ai)
2. Click the "Add API Token" prompt in the status bar, or
3. Open Command Palette (Ctrl+Shift+P / Cmd+Shift+P) and run `MarkupAI: Configure API Token`

### 3. Start Writing

Open any text document and MarkupAI will automatically analyze your content!

## Commands

| Command                           | Description                               |
| --------------------------------- | ----------------------------------------- |
| `Markup AI: Check Content`        | Manually trigger a content check          |
| `Markup AI: Configure API Token`  | Set or update your API token              |
| `Markup AI: Select Style Guide`   | Choose a style guide for content analysis |
| `Markup AI: Select Dialect`       | Choose your preferred English dialect     |
| `Markup AI: Show Content Scores`  | View detailed quality scores              |
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

| Setting                  | Description                                                            | Default            |
| ------------------------ | ---------------------------------------------------------------------- | ------------------ |
| `markupai.apiToken`      | Your Markup AI API token                                               | -                  |
| `markupai.enabled`       | Enable/disable Markup AI checking                                      | `true`             |
| `markupai.dialect`       | Language dialect (american_english, british_english, canadian_english) | `american_english` |
| `markupai.styleGuide`    | Style guide to use (ap, chicago, microsoft, or custom ID)              | `ap`               |
| `markupai.checkOnOpen`   | Automatically check when a file is opened                              | `true`             |
| `markupai.checkOnChange` | Automatically check when content changes                               | `true`             |
| `markupai.checkDelay`    | Delay (ms) before checking after a change                              | `2000`             |

## Issue Severity Levels

Issues are highlighted with different colors based on severity:

- 🔴 **Error** (red underline): High severity issues
- 🟡 **Warning** (yellow underline): Medium severity issues
- 🔵 **Information** (blue underline): Low severity suggestions

## Requirements

- VS Code 1.108.1 or higher (Desktop, Web, or Remote)
- MarkupAI API token (get one at [markup.ai](https://markup.ai))

## Platform Support

This extension works on:

- ✅ **VS Code Desktop** (Windows, macOS, Linux)
- ✅ **VS Code for Web** ([vscode.dev](https://vscode.dev))
- ✅ **GitHub Web Editor** ([github.dev](https://github.dev))
- ✅ **Remote Development** (SSH, Containers, WSL)
- ✅ **Virtual Workspaces** (Cloud storage, read-only folders)

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
npm run lint

# Package extension
npm run package
```

## Support

For issues, feature requests, or questions, please visit the [MarkupAI documentation](https://docs.markup.ai) or contact support.
