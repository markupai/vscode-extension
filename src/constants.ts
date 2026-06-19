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

/** Hosted sidebar app, embedded as an iframe in sidebar mode. */
export const SIDEBAR_URLS: Record<MarkupAIEnvironment, string> = {
  prod: "https://sidebar.markup.ai/",
  dev: "https://sidebar.dev.markup.ai/",
};

/**
 * Sidebar integration identity. The sidebar lowercases integrationName to
 * derive its mediation OAuth provider, so it must match the dedicated
 * "vscode-extension" Auth0 integration (registered in helios-core #2402).
 */
export const SIDEBAR_INTEGRATION_NAME = "vscode-extension";
export const SIDEBAR_INTEGRATION_ID = "vscode-extension";

/**
 * OAuth mediation provider for the native sign-in flow. Matches the
 * dedicated "vscode-extension" Auth0 integration (helios-core #2402); this
 * replaced the temporary "figma" provider once the VS Code integration was
 * registered in Auth0.
 */
export const OAUTH_PROVIDER = "vscode-extension";

/** Sent as x-integration-id on every API request. */
export const INTEGRATION_ID = "vscode_extension";

export const USER_MESSAGE_PREFIX = "MarkupAI: ";

// ============================================================================
// Supported File Extensions
// ============================================================================

export const SUPPORTED_FILE_EXTENSIONS = [".md", ".txt", ".dita", ".html", ".htm", ".xml"];
