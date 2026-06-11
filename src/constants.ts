// ============================================================================
// API Configuration
// ============================================================================

export const POLL_INTERVAL_MS = 2000;
export const POLL_TIMEOUT_MS = 120_000;

/** Style Agent rejects documents above this many characters. */
export const MAX_TEXT_LENGTH = 100_000;

export const ENVIRONMENT_URLS = {
  prod: "https://api.markup.ai",
  dev: "https://api.dev.markup.ai",
} as const;

export type MarkupAIEnvironment = keyof typeof ENVIRONMENT_URLS;

/**
 * OAuth mediation integration. The "figma" integration is registered in
 * Auth0 and works today; swap for a dedicated "vscode" integration once
 * it is registered.
 */
export const OAUTH_PROVIDER = "figma";

/** Sent as x-integration-id on every API request. */
export const INTEGRATION_ID = "vscode_extension";

export const USER_MESSAGE_PREFIX = "MarkupAI: ";

// ============================================================================
// Supported File Extensions
// ============================================================================

export const SUPPORTED_FILE_EXTENSIONS = [".md", ".txt", ".dita", ".html", ".htm", ".xml"];
