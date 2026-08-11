import { describe, it, expect } from "vitest";
import { decodeHtmlEntities } from "../src/htmlEntities";

describe("decodeHtmlEntities", () => {
  it("decodes named entities", () => {
    expect(decodeHtmlEntities("Tom &amp; Jerry")).toBe("Tom & Jerry");
    expect(decodeHtmlEntities("&lt;b&gt;bold&lt;/b&gt;")).toBe("<b>bold</b>");
    expect(decodeHtmlEntities("&quot;quoted&quot;")).toBe('"quoted"');
    expect(decodeHtmlEntities("don&apos;t")).toBe("don't");
    expect(decodeHtmlEntities("a&nbsp;b")).toBe("a\u00a0b");
    expect(decodeHtmlEntities("&ldquo;hi&rdquo; &ndash; &hellip;")).toBe("“hi” – …");
  });

  it("decodes decimal numeric references", () => {
    expect(decodeHtmlEntities("don&#39;t")).toBe("don't");
    expect(decodeHtmlEntities("&#65;&#66;&#67;")).toBe("ABC");
  });

  it("decodes hexadecimal numeric references", () => {
    expect(decodeHtmlEntities("don&#x27;t")).toBe("don't");
    expect(decodeHtmlEntities("&#x1F600;")).toBe("😀");
  });

  it("leaves unknown entities and invalid code points untouched", () => {
    expect(decodeHtmlEntities("&notarealentity;")).toBe("&notarealentity;");
    expect(decodeHtmlEntities("&#1114112;")).toBe("&#1114112;");
  });

  it("leaves bare ampersands and plain text untouched", () => {
    expect(decodeHtmlEntities("fish & chips")).toBe("fish & chips");
    expect(decodeHtmlEntities("no entities here")).toBe("no entities here");
    expect(decodeHtmlEntities("")).toBe("");
  });

  it("decodes mixed content", () => {
    expect(decodeHtmlEntities("Use &quot;don&#39;t&quot; &amp; &lt;code&gt;")).toBe(
      'Use "don\'t" & <code>',
    );
  });
});
