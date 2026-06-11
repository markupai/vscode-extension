import { MarkupAI } from "@markupai/api";
import { StyleGuideOption } from "./types";

// ============================================================================
// Language Dialects
// ============================================================================

export const DIALECTS: { value: MarkupAI.Dialects; label: string }[] = [
  { value: "american_english", label: "American English" },
  { value: "british_english", label: "British English" },
  { value: "canadian_english", label: "Canadian English" },
];

// ============================================================================
// Built-in Style Guides
// ============================================================================

export const BUILT_IN_STYLE_GUIDES: StyleGuideOption[] = [
  { id: "ap", name: "AP Style Guide", isBuiltIn: true },
  { id: "chicago", name: "Chicago Manual of Style", isBuiltIn: true },
  { id: "microsoft", name: "Microsoft Style Guide", isBuiltIn: true },
];

// ============================================================================
// API Configuration
// ============================================================================

export const POLL_INTERVAL_MS = 2000;
export const MAX_POLL_ATTEMPTS = 60; // 2 minutes max
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
