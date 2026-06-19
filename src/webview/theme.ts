/**
 * VS Code stamps the active theme kind on the webview body as
 * `data-vscode-theme-kind` and as a matching class — one of `vscode-light`,
 * `vscode-dark`, `vscode-high-contrast` (high-contrast dark), or
 * `vscode-high-contrast-light`. We translate that into a CSS `color-scheme`
 * so the embedded sidebar iframe — which follows `prefers-color-scheme` in
 * its default "system" theme mode — tracks the editor's light/dark theme.
 */
export type ColorScheme = "dark" | "light";

/** The only two theme kinds that should render the sidebar in dark mode. */
const DARK_KINDS = new Set(["vscode-dark", "vscode-high-contrast"]);

/** Minimal view of `DOMTokenList`, so this stays unit-testable without a DOM. */
export interface ClassListLike {
  contains(token: string): boolean;
}

/**
 * Resolve a CSS `color-scheme` from VS Code's theme kind. Prefers the
 * `data-vscode-theme-kind` value; when it is absent, falls back to the body
 * classes. Only the two dark kinds map to "dark" — high-contrast-light is a
 * light theme and must not be treated as dark.
 */
export function themeKindToColorScheme(kind: string, classList: ClassListLike): ColorScheme {
  if (kind) {
    return DARK_KINDS.has(kind) ? "dark" : "light";
  }
  // No data attribute — fall back to the body classes. Check the
  // high-contrast-light token first so it is never caught by a looser match.
  if (classList.contains("vscode-high-contrast-light")) {
    return "light";
  }
  if (classList.contains("vscode-dark") || classList.contains("vscode-high-contrast")) {
    return "dark";
  }
  return "light";
}
