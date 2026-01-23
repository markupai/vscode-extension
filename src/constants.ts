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

// ============================================================================
// Supported File Extensions
// ============================================================================

export const SUPPORTED_FILE_EXTENSIONS = [".md", ".txt", ".dita", ".html", ".htm", ".xml"];
