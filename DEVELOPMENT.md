# Development

Contributor notes for Markup AI Lint. For what the extension does and how to use it, see the [README](README.md).

## Commands

All commands are listed under the **Markup AI Lint** category in the Command Palette.

| Command                                 | Description                               |
| --------------------------------------- | ----------------------------------------- |
| `Markup AI Lint: Check Content`         | Manually trigger a content check          |
| `Markup AI Lint: Sign In`               | Sign in via browser or paste a token      |
| `Markup AI Lint: Sign Out`              | Sign out and clear the stored session     |
| `Markup AI Lint: Select Style Guide`    | Choose a style guide for content analysis |
| `Markup AI Lint: Show Content Scores`   | View the risk assessment breakdown        |
| `Markup AI Lint: Toggle Enable/Disable` | Enable or disable the extension           |
| `Markup AI Lint: Change Folder`         | Choose a folder to check multiple files   |
| `Markup AI Lint: Check All Files`       | Check all files in selected folder        |
| `Markup AI Lint: Check Selected Files`  | Check only selected files in folder       |

## Configuration

| Setting                       | Description                                                   | Default |
| ----------------------------- | ------------------------------------------------------------- | ------- |
| `markupai-lint.enabled`       | Enable/disable Markup AI Lint checking                        | `true`  |
| `markupai-lint.styleGuide`    | Style guide ID (empty = organization default; use the picker) | `""`    |
| `markupai-lint.checkOnOpen`   | Automatically check when a file is opened                     | `true`  |
| `markupai-lint.checkOnChange` | Automatically check when content changes                      | `false` |
| `markupai-lint.checkDelay`    | Delay (ms) before checking after a change                     | `2000`  |

Sign-in tokens are stored securely in VS Code Secret Storage, not in settings.

## Platform Support

- ✅ **VS Code Desktop** (Windows, macOS, Linux)
- ✅ **Remote Development** (SSH, Containers, WSL)
- ✅ **Virtual Workspaces** (Cloud storage, read-only folders)
- 🚧 **VS Code for Web** — not yet available (see below)

### Web Compatibility

The extension codebase is web-compatible — no Node.js built-in modules are used, and all file operations go through VS Code's `workspace.fs` API. A browser-targeted bundle is built and validated in CI to prevent regressions.

However, the extension currently **works on desktop only** because the Markup AI API does not yet allow browser CORS requests from the web extension host. Once the API CORS allowlist is updated, the existing web bundle (wired up via the `browser` entry in `package.json`) will work as-is.

## Building & Testing

```bash
# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Run tests (Vitest; 90%+ coverage across all modules)
npm test

# Run tests with coverage
npm run test:coverage

# Interactive test UI
npm run test:ui

# Run linter
npm run lint:check

# Package extension
npm run package

# Validate web compatibility
npx @vscode/vsce package --target web --out dist/web.vsix
```

## CI/CD Pipeline

The GitHub Actions workflow (`build.yml`) runs the following checks on every push and pull request:

1. **Code formatting** — `prettier --check`
2. **Type checking** — `tsc --noEmit`
3. **Linting** — `eslint`
4. **Compile** — esbuild bundles for desktop (Node.js) and web (browser)
5. **Tests** — `vitest` with coverage
6. **SonarQube scan** — static analysis
7. **Web bundle verification** — ensures the browser-targeted bundle builds successfully (catches accidental Node.js imports)
8. **Package** — produces the desktop VSIX artifact

Releases are published from the `Release` workflow (`release.yml`) — CI-only, authenticated via GitHub OIDC → Microsoft Entra ID; see the workflow header comments.
