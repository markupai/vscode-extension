import { describe, it, expect } from "vitest";
import { themeKindToColorScheme, type ClassListLike } from "../src/webview/theme";

/** Build a ClassListLike from a list of present class tokens. */
function classList(...tokens: string[]): ClassListLike {
  const set = new Set(tokens);
  return { contains: (token: string) => set.has(token) };
}

describe("themeKindToColorScheme", () => {
  describe("from data-vscode-theme-kind", () => {
    it.each([
      ["vscode-dark", "dark"],
      ["vscode-high-contrast", "dark"],
      ["vscode-light", "light"],
      ["vscode-high-contrast-light", "light"],
    ] as const)("maps %s to %s", (kind, expected) => {
      expect(themeKindToColorScheme(kind, classList())).toBe(expected);
    });

    it("ignores the body classes when the kind is present", () => {
      // Kind says light; a stray dark class must not flip it.
      expect(themeKindToColorScheme("vscode-light", classList("vscode-dark"))).toBe("light");
    });

    it("treats an unknown kind as light", () => {
      expect(themeKindToColorScheme("vscode-future", classList())).toBe("light");
    });
  });

  describe("falling back to body classes when the kind is absent", () => {
    it("maps vscode-dark to dark", () => {
      expect(themeKindToColorScheme("", classList("vscode-dark"))).toBe("dark");
    });

    it("maps vscode-high-contrast to dark", () => {
      expect(themeKindToColorScheme("", classList("vscode-high-contrast"))).toBe("dark");
    });

    it("maps vscode-high-contrast-light to light", () => {
      expect(themeKindToColorScheme("", classList("vscode-high-contrast-light"))).toBe("light");
    });

    it("maps vscode-light to light", () => {
      expect(themeKindToColorScheme("", classList("vscode-light"))).toBe("light");
    });

    it("defaults to light when no recognized class is present", () => {
      expect(themeKindToColorScheme("", classList())).toBe("light");
    });
  });
});
