import { describe, expect, it } from "vitest";
import { convertForAgents, detectKind } from "../../src/converters/index.js";

describe("detectKind", () => {
  it.each([
    ["foo.md", "markdown"],
    ["foo.markdown", "markdown"],
    ["foo.html", "html"],
    ["foo.htm", "html"],
    ["foo.xhtml", "html"],
    ["foo.dita", "dita"],
    ["foo.ditamap", "dita"],
    ["foo.txt", "text"],
    ["foo.rst", "text"],
  ] as const)("detects %s as %s", (name, kind) => {
    expect(detectKind(name)).toBe(kind);
  });
});

describe("convertForAgents", () => {
  it("markdown source stays as markdown for any agent", () => {
    const r = convertForAgents("# Hi", "doc.md", false);
    expect(r.contentProfile).toBe("markdown");
    expect(r.markdown).toBe("# Hi");
  });

  it("dita source + style agent returns raw dita profile", () => {
    const r = convertForAgents("<title>t</title>", "a.dita", true);
    expect(r.contentProfile).toBe("dita");
    expect(r.markdown).toContain("<title>");
  });

  it("dita source + non-style agents gets converted to markdown", () => {
    const r = convertForAgents("<title>t</title>", "a.dita", false);
    expect(r.contentProfile).toBe("markdown");
    expect(r.markdown).toContain("# t");
  });

  it("html source always converts to markdown", () => {
    const rStyle = convertForAgents("<h1>H</h1>", "p.html", true);
    const rOther = convertForAgents("<h1>H</h1>", "p.html", false);
    expect(rStyle.contentProfile).toBe("markdown");
    expect(rOther.contentProfile).toBe("markdown");
  });
});
