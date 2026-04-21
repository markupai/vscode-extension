# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install

npm run compile              # esbuild → out/extension.js (node) + out/web/extension.js (browser)
npm run compile:watch        # both targets in watch mode
npm run package              # produces dist/*.vsix (auto-mkdirs dist/)

npm test                     # vitest run
npm run test:watch           # vitest watch
npm run test:coverage        # v8 coverage; thresholds enforced (lines/fns/stmts ≥80, branches ≥75)
npm run type-check           # tsc --noEmit
npm run lint:check           # strictTypeChecked
npm run lint:fix
npm run format:check
npm run format
```

Run a single test file: `npx vitest run test/<module>.test.ts`. Run a single test by name: `npx vitest run -t "test name"`.

Debugging: press **F5** to launch _Run Extension (Desktop)_ or _Run Extension (Web)_; both pre-run `npm: compile` and open a second window on `testdoc/`.

## Build-time environment (dev vs prod)

The default API environment is **baked into the bundle at compile time**, not read at runtime. `esbuild.mjs` parses `MARKUPAI_ENV` from (a) the inline shell env, then (b) a `.env` file at repo root, defaulting to `prod`. esbuild's `define` replaces `process.env.MARKUPAI_BUILD_ENV` with a literal; [src/constants.ts](src/constants.ts) reads that constant into `BUILD_DEFAULT_ENVIRONMENT`.

- Released builds (no `.env`): `api.markup.ai`
- `MARKUPAI_ENV=dev npm run compile` or `.env` with `MARKUPAI_ENV=dev`: `api.dev.markup.ai`
- Users can force either at runtime via the `markupai.environment` setting (`default` / `dev` / `prod`)

If you change build-time env handling, update both `esbuild.mjs` and `src/constants.ts` — they're tightly coupled.

## Architecture — what requires reading multiple files to understand

**Parallel-executor call pattern.** The MarkupAI API doesn't run agents directly — you POST to `/agents/{PARALLEL_EXECUTOR_AGENT_ID}/run` (id hardcoded in [src/constants.ts](src/constants.ts)) with a list of worker-agent internal IDs in the body, then open an SSE stream on `/agents/workflows/{workflow_id}/stream`. See [src/apiClient.ts](src/apiClient.ts). The `/agents` list endpoint returns `{ agents }` (not `{ data }`); run response is flat `{ workflow_id }` (not `{ data: { workflow_id } }`). This shape differs from what the chrome-extension's generated client suggests — always smoke-test against the live API if in doubt.

**Compile-time agent allowlist.** `ENABLED_AGENT_SLUGS` in [src/constants.ts](src/constants.ts) is the upper bound of agents this build exposes. At runtime, [src/agentRegistry.ts](src/agentRegistry.ts) intersects the `/agents` response with this set — agents absent from the platform are silently dropped; agents removed from the allowlist never appear regardless of platform state. To enable a new agent, add its slug here AND ensure the platform exposes it.

**Content-profile buckets.** [src/scanner.ts](src/scanner.ts) can split a single scan into multiple parallel requests, each with its own `content_profile_id`:
- `style_agent` + `.dita` source → one bucket with `content_profile_id: "dita"`, raw XML as `text`
- all other combinations → one bucket with `content_profile_id: "markdown"`, HTML/DITA first converted to markdown

Each bucket gets its own SSE stream; results are merged.

**Offset remapping.** When a converter (HTML→MD or DITA→MD) produces the text sent to an agent, it also emits an `OffsetMap` — a sparse list of `{md, src}` pairs. Agent-returned issue positions live in the *markdown* coordinate space; [src/issueRemapping.ts](src/issueRemapping.ts) binary-searches the map to project them back to *source* offsets before they're published as diagnostics. If you add a new converter, it MUST emit an accurate `OffsetMap`.

**Per-agent diagnostics index.** [src/diagnostics.ts](src/diagnostics.ts) stores issues in a `Map<uri, Map<agentSlug, issues[]>>`, publishing all agents' issues into a single `DiagnosticCollection`. Re-scanning one agent replaces only that agent's entries — the others persist. Hover and code-action lookups iterate the nested map to find all issues overlapping a cursor position.

**Web compatibility.** Both `main` (node) and `browser` (web) point at bundles from the same `src/extension.ts` — there's no Node-only code outside the build tooling. SSE uses `fetch` + `ReadableStream.getReader()` (see `parseSSE` in [src/apiClient.ts](src/apiClient.ts)); webview nonces use `globalThis.crypto.getRandomValues`. CI verifies `out/web/extension.js` exists. When editing platform-sensitive code (streams, crypto, storage), test both bundles.

**Webview CSP.** Webviews use nonce-guarded inline `<script>` via `webviewScaffold` in [src/views/webviewShared.ts](src/views/webviewShared.ts). Never bypass `escapeHtml` when interpolating user/model values into the HTML body.

## Testing

`vscode` is aliased to [test/mocks/vscode.ts](test/mocks/vscode.ts) via [vitest.config.ts](vitest.config.ts) — the mock is hand-written and only covers the API surface the extension actually uses. If a new piece of production code calls a `vscode.*` symbol the mock doesn't expose yet, add it to the mock.

`src/extension.ts` is excluded from coverage (activation/wiring only). Any logic that could live elsewhere SHOULD live elsewhere and be tested to the general threshold.

## Conventions (from `.cursor/rules/project-conventions.mdc`)

- One module per concern in `src/`; each has a matching `test/<module>.test.ts`
- Shared types in [src/types.ts](src/types.ts); shared constants in [src/constants.ts](src/constants.ts)
- `readonly` on fields assigned once; explicit return types on exported functions
- Prefer `interface` over `type` for object shapes
- User-facing error messages prefixed with `"MarkupAI: "` (see `USER_MESSAGE_PREFIX`)
- Unused parameters prefixed with `_`
- No `any` — use `unknown` and narrow
- Don't add dependencies without approval; don't commit `.env`

## CI gates

`.github/workflows/build.yml` enforces, in order: `format:check` → `type-check` → `lint:check` → `compile` → `test:coverage` → SonarCloud scan → web bundle exists → `package`. SonarCloud quality gate blocks on: ≥ A reliability on new code, zero open security hotspots. Cognitive-complexity and weak-hash-looking code tend to be the common flags — check [src/converters/htmlToMarkdown.ts](src/converters/htmlToMarkdown.ts) for the Map-dispatch pattern that keeps complexity low.
