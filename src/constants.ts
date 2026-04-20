// ===================================================================
// MarkupAI extension — compile-time constants
// ===================================================================

export const EXTENSION_ID = "markupai-vscode";
export const EXTENSION_NAME = "MarkupAI";
export const DIAGNOSTIC_SOURCE = "MarkupAI";
export const USER_MESSAGE_PREFIX = "MarkupAI: ";

// ===================================================================
// API
// ===================================================================

export const API_BASE_URLS = {
  dev: "https://api.dev.markup.ai",
  prod: "https://api.markup.ai",
} as const;

/**
 * Default environment baked in at compile time. Esbuild's `define`
 * replaces `process.env.MARKUPAI_BUILD_ENV` with a literal, so the
 * value here is the bundle's default and cannot be changed at runtime
 * short of the user flipping `markupai.environment`.
 *
 * Set by `.env` (MARKUPAI_ENV=dev) at build time. Released/prod builds
 * have no `.env`, so this defaults to `prod`.
 */
export const BUILD_DEFAULT_ENVIRONMENT: "dev" | "prod" =
  process.env.MARKUPAI_BUILD_ENV === "dev" ? "dev" : "prod";

/**
 * The "Parallel Executor" agent orchestrates a set of worker agents.
 * We POST `/agents/{PARALLEL_EXECUTOR_AGENT_ID}/run` with the list of
 * worker-agent internal IDs in the body. This matches the pattern used
 * by the MarkupAI browser extension.
 */
export const PARALLEL_EXECUTOR_AGENT_ID = "ag_cnct5nkhtfNk";

export const INTEGRATION_ID = "vscode_extension";

// ===================================================================
// Agents — compile-time allowlist
// ===================================================================

/**
 * Slugs of agents this build of the extension is allowed to surface.
 * Agents returned by the server are intersected with this list, so
 * removing an entry here hides the agent regardless of platform state.
 *
 * To disable an agent for a specific build, comment it out and recompile.
 */
export const ENABLED_AGENT_SLUGS: readonly string[] = [
  // brand & style
  "style_agent",
  "brand_voice",
  "terminology",
  // integrity & AI detection
  "ai_voice_detector",
  "focus_agent",
  "sentence_clarity",
  // accuracy
  "generic_claims",
  "source_authority",
  "freshness",
  // generative / GEO
  "snippet_readiness",
  "answer_authority",
  // personas
  "persona",
];

// ===================================================================
// Content profiles
// ===================================================================

export const CONTENT_PROFILE = {
  markdown: "markdown",
  dita: "dita",
} as const;

// ===================================================================
// File-type dispatch
// ===================================================================

/** Extensions we can natively scan (after optional markdown conversion). */
export const SUPPORTED_EXTENSIONS = [
  ".md",
  ".markdown",
  ".txt",
  ".html",
  ".htm",
  ".xhtml",
  ".dita",
  ".xml",
  ".rst",
] as const;
