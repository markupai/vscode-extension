import { describe, expect, it } from "vitest";
import {
  defaultCsp,
  escapeHtml,
  makeNonce,
  sharedStyles,
  webviewScaffold,
} from "../../src/views/webviewShared.js";

describe("webviewShared helpers", () => {
  it("makeNonce returns a 32-char hex string", () => {
    const n = makeNonce();
    expect(n).toMatch(/^[0-9a-f]{32}$/);
    expect(makeNonce()).not.toBe(n);
  });

  it("escapeHtml escapes the core entities", () => {
    expect(escapeHtml('<a href="x">A&B</a>')).toBe("&lt;a href=&quot;x&quot;&gt;A&amp;B&lt;/a&gt;");
    expect(escapeHtml("'")).toBe("&#39;");
  });

  it("defaultCsp includes the nonce and the cspSource", () => {
    const csp = defaultCsp("abc", "https://example");
    expect(csp).toContain("'nonce-abc'");
    expect(csp).toContain("https://example");
    expect(csp).toContain("default-src 'none'");
  });

  it("sharedStyles is a non-empty CSS blob", () => {
    const s = sharedStyles();
    expect(s.length).toBeGreaterThan(200);
    expect(s).toContain("body");
  });

  it("webviewScaffold embeds body and script with a nonce", () => {
    const webview = { cspSource: "https://w" } as any;
    const html = webviewScaffold(webview, "T", "<p>body</p>", "console.log(1)");
    expect(html).toContain("<p>body</p>");
    expect(html).toContain("console.log(1)");
    expect(html).toMatch(/nonce="[0-9a-f]{32}"/);
    expect(html).toContain('<meta http-equiv="Content-Security-Policy"');
    expect(html).toContain("<title>T</title>");
  });
});
