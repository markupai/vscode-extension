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

export const CONSOLE_URLS: Record<MarkupAIEnvironment, string> = {
  prod: "https://console.markup.ai",
  dev: "https://console.dev.markup.ai",
};

/**
 * OAuth mediation provider for the native sign-in flow. Matches the
 * dedicated "vscode-extension" Auth0 integration (helios-core #2402); this
 * replaced the temporary "figma" provider once the VS Code integration was
 * registered in Auth0.
 */
export const OAUTH_PROVIDER = "vscode-extension";

/** Sent as x-integration-id on every API request. */
export const INTEGRATION_ID = "vscode_extension";

/**
 * Marketing attribution for the Console signup link. utm_source matches the
 * `markup_<oauth-provider>` value the OAuth relay puts on its Auth0 authorize
 * URL, so both signup paths report the same source.
 */
export const SIGNUP_UTM_PARAMS = `utm_source=markup_${OAUTH_PROVIDER}&utm_medium=in-app`;

export const USER_MESSAGE_PREFIX = "Markup AI Lint: ";

// ============================================================================
// Supported File Extensions
// ============================================================================

export const SUPPORTED_FILE_EXTENSIONS = [".md", ".txt", ".dita", ".html", ".htm", ".xml"];
