# MarkupAI for VS Code

Native VS Code extension for the MarkupAI agents platform. Run style, terminology,
and accuracy checks on your documents directly from the editor — issues appear as
diagnostics with inline suggestions and quick-fixes.

Works on both **VS Code Desktop** and **vscode.dev / github.dev** (web).

## Features

- **Browser-mediated sign-in** — `MarkupAI: Sign In` opens sidebar-app in the default browser; Auth0 access token stored in VS Code `SecretStorage`
- **Environment switch** — `dev` (api.dev.markup.ai) vs `prod` (api.markup.ai) via settings
- **Multi-agent scan** — run one or many agents in parallel through the platform executor
- **Compile-time agent gating** — builds ship with a curated allowlist; agents unavailable
  at runtime are transparently hidden
- **Agent Configuration sidebar** — toggle individual agents and set the Style agent's target
- **Batch Check sidebar** — run a scan across any subset of files in the workspace
- **Diagnostics + Hover + Quick-Fix** — issues squiggle in the editor, explanations on hover,
  "Apply suggestion" code action when the agent returns a replacement
- **Converts on demand** — HTML → Markdown and DITA → Markdown for non-style agents
  (the Style agent reads DITA as-is when the source is `.dita`)
- **Web-compatible bundle** — pure `fetch` + `ReadableStream`, no Node-only modules

## Install & run in development

```bash
npm install
npm run compile         # builds both desktop + web bundles
```

Open the repo in VS Code and press **F5** (or pick _Run Extension (Desktop)_ from the
Run menu). A second VS Code window opens with the `testdoc/` folder loaded.

### Debugging

Two pre-configured launch profiles:

- **Run Extension (Desktop)** — normal extension host; breakpoints in `out/extension.js`
- **Run Extension (Web)** — `--extensionDevelopmentKind=web`; validates the browser bundle

Both auto-trigger `npm: compile` as a pre-launch task.

### First-time setup in the dev window

1. `Cmd+Shift+P` → **MarkupAI: Sign In** — completes in your default browser
2. **MarkupAI: Open Agent Configuration** — toggle which agents you want enabled
3. Open any `.md`, `.html`, or `.dita` file → `Cmd+Shift+P` → **MarkupAI: Scan Current File**

## Configuration

| Setting                       | Default   | Description                                                                     |
| ----------------------------- | --------- | ------------------------------------------------------------------------------- |
| `markupai.environment`        | `default` | `default` (build-time), `dev`, or `prod`. Leave at `default` unless overriding. |
| `markupai.enabledAgents`      | `[]`      | Slugs to enable; empty = all compile-time allowed agents                        |
| `markupai.styleGuideTargetId` | `""`      | Default target id used by the Style agent                                       |
| `markupai.logLevel`           | `info`    | `debug` / `info` / `warn` / `error`                                             |

### Build-time environment (dev vs prod)

Released builds point at **`api.markup.ai`**. To compile a build that points at
**`api.dev.markup.ai`** by default, set `MARKUPAI_ENV=dev` either as an inline env
or in a `.env` file at the repo root:

```bash
cp .env.example .env      # contains MARKUPAI_ENV=dev
npm run compile           # logs: "build-time environment = dev"
```

The esbuild step bakes the chosen environment into the bundle as a constant. Users
can still override per-workstation via the `markupai.environment` VS Code setting.

## Authentication

A single Auth0 access token (JWT) is stored in VS Code `SecretStorage` and sent
on every API call (agent endpoints and `/internal/*` alike).

- **Desktop** — `MarkupAI: Sign In` opens `sidebar-app` in your default browser.
  After you authenticate, sidebar-app POSTs the access token back to a short-lived
  local callback (`http://127.0.0.1:<random>/cb`) and the extension stores it.
- **Web** (`vscode.dev` / `github.dev`) — local callback servers aren't available,
  so `MarkupAI: Sign In` falls back to a paste prompt. Get the token from the
  sidebar-app after signing in there.

### Sidebar-app contract

The browser flow depends on `sidebar-app` honouring two URL params:

```
https://sidebar.dev.markup.ai/?vscode_cb=<callback-url>&vscode_state=<nonce>
```

After the auth session is established, sidebar-app must:

```js
await fetch(vscode_cb, {
  method: "POST",
  mode: "no-cors",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    state: vscode_state,
    access_token: "<auth0 access token>",
    expires_at: 1234567890, // optional
    refresh_token: "…", // optional
  }),
});
```

The state nonce binds the response to the extension that started the flow; a
mismatch is rejected with 400.

## Commands

- `MarkupAI: Sign In / Sign Out`
- `MarkupAI: Scan Current File`
- `MarkupAI: Clear Diagnostics`
- `MarkupAI: Refresh Agents`
- `MarkupAI: Open Agent Configuration`
- `MarkupAI: Open Batch Check`

## Compile-time agent gating

Edit `ENABLED_AGENT_SLUGS` in [src/constants.ts](src/constants.ts#L32) to change which
agents this build exposes. Agents disabled here never appear in the UI, regardless of
platform availability. Conversely, agents listed here but not exposed by the platform
are silently skipped at runtime.

## Scripts

| Command                 | What it does                                     |
| ----------------------- | ------------------------------------------------ |
| `npm run compile`       | esbuild desktop + web bundles → `out/`           |
| `npm run compile:watch` | rebuild on change                                |
| `npm test`              | run the Vitest suite                             |
| `npm run test:coverage` | run tests with v8 coverage (thresholds enforced) |
| `npm run type-check`    | `tsc --noEmit`                                   |
| `npm run lint:check`    | ESLint strict-type-checked                       |
| `npm run format:check`  | Prettier                                         |
| `npm run package`       | produce a `.vsix` in `dist/`                     |

## Project layout

```
src/
  constants.ts              # compile-time allowlist, endpoints, prefixes
  types.ts                  # shared interfaces
  config.ts                 # VS Code settings accessor
  logger.ts                 # OutputChannel-backed logger
  auth.ts                   # SecretStorage token + sign-in prompt
  apiClient.ts              # fetch + SSE (web-safe)
  agentRegistry.ts          # platform agents ∩ compile-time allowlist
  converters/               # html→md, dita→md, markdown passthrough
  issueRemapping.ts         # md-offset → source-offset remap
  scanner.ts                # bucket splitter + orchestrator
  diagnostics.ts            # DiagnosticCollection + per-agent index
  hoverProvider.ts          # explanation + suggestion hover
  codeActionProvider.ts     # "Apply suggestion" / "Dismiss" quick-fixes
  commands.ts               # command registrations + scan flow
  views/
    agentConfigView.ts      # sidebar: enabled agents + target id
    batchCheckView.ts       # sidebar: multi-file scan
    webviewShared.ts        # CSP helper + shared styles
  extension.ts              # thin orchestrator (excluded from coverage)
test/                       # vitest suite + vscode API mock
testdoc/                    # sample md/html/dita for manual testing
```

## Web compatibility

The extension is built with `"browser": "./out/web/extension.js"`. CI verifies the
web bundle exists after compile. Both builds share the same source — no Node-only
imports outside the build tooling.
