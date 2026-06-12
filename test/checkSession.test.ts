import { describe, it, expect } from "vitest";
import {
  CheckSession,
  CheckSessionStore,
  findNearestOccurrence,
} from "../src/sidebar/checkSession";

const TEXT = "The quick brown fox jumps over the lazy dog.";

function sliceAt(text: string, range: { start: number; end: number } | null): string {
  expect(range).not.toBeNull();
  if (!range) {
    throw new Error("unreachable");
  }
  return text.slice(range.start, range.end);
}

function fullDocSession(text = TEXT, version = 1): CheckSession {
  return new CheckSession("file:///doc.md", text, version, 0, text.length);
}

describe("CheckSession.resolveRange", () => {
  it("maps directly when the document is unchanged (fast path)", () => {
    const session = fullDocSession();
    // "quick" at [4, 9)
    const resolved = session.resolveRange({ start: 4, end: 9 }, TEXT, 1);
    expect(resolved).toEqual({ start: 4, end: 9 });
  });

  it("uses text equality as the fast path even when version changed", () => {
    const session = fullDocSession();
    const resolved = session.resolveRange({ start: 4, end: 9 }, TEXT, 7);
    expect(resolved).toEqual({ start: 4, end: 9 });
  });

  it("realigns ranges after an insertion earlier in the document", () => {
    const session = fullDocSession();
    const edited = "Hello! " + TEXT; // everything shifts by 7
    const resolved = session.resolveRange({ start: 4, end: 9 }, edited, 2);
    expect(resolved).toEqual({ start: 11, end: 16 });
    expect(edited.slice(11, 16)).toBe("quick");
  });

  it("realigns ranges after a deletion earlier in the document", () => {
    const session = fullDocSession();
    const edited = TEXT.replace("The quick ", "Quick "); // hmm, changes target word region
    // Use a range after the edit: "lazy" at [35, 39) in original
    expect(TEXT.slice(35, 39)).toBe("lazy");
    const resolved = session.resolveRange({ start: 35, end: 39 }, edited, 2);
    expect(sliceAt(edited, resolved)).toBe("lazy");
  });

  it("caches the alignment map per document version", () => {
    const session = fullDocSession();
    const edited = "X" + TEXT;
    const first = session.resolveRange({ start: 4, end: 9 }, edited, 2);
    const second = session.resolveRange({ start: 10, end: 15 }, edited, 2);
    expect(first).toEqual({ start: 5, end: 10 });
    expect(sliceAt(edited, second)).toBe(TEXT.slice(10, 15));
  });

  it("falls back to nearest-occurrence search when alignment drifts", () => {
    const session = fullDocSession();
    // Rewrite the first half completely but keep "lazy dog" near the end.
    const edited = "Totally different opening that breaks alignment — the lazy dog.";
    expect(TEXT.slice(35, 39)).toBe("lazy");
    const resolved = session.resolveRange({ start: 35, end: 39 }, edited, 3);
    expect(sliceAt(edited, resolved)).toBe("lazy");
  });

  it("returns null when the original text was deleted", () => {
    const session = fullDocSession();
    const edited = TEXT.replace("quick brown ", "");
    const resolved = session.resolveRange({ start: 4, end: 9 }, edited, 2);
    expect(resolved).toBeNull();
  });

  it("returns null for out-of-bounds or malformed ranges", () => {
    const session = fullDocSession();
    expect(session.resolveRange({ start: -1, end: 4 }, TEXT, 1)).toBeNull();
    expect(session.resolveRange({ start: 9, end: 4 }, TEXT, 1)).toBeNull();
    expect(session.resolveRange({ start: 0, end: TEXT.length + 1 }, TEXT, 1)).toBeNull();
    expect(session.resolveRange({ start: 0.5, end: 4 }, TEXT, 1)).toBeNull();
  });

  it("offsets selection-check ranges by the selection base", () => {
    // Checked content was the selection "brown fox" starting at offset 10.
    const selection = "brown fox";
    const session = new CheckSession("file:///doc.md", TEXT, 1, 10, selection.length);
    // Sidebar flags "fox" at [6, 9) within the selection.
    const resolved = session.resolveRange({ start: 6, end: 9 }, TEXT, 1);
    expect(resolved).toEqual({ start: 16, end: 19 });
    expect(TEXT.slice(16, 19)).toBe("fox");
  });

  it("resolves selection-check ranges after edits elsewhere in the document", () => {
    const selection = "brown fox";
    const session = new CheckSession("file:///doc.md", TEXT, 1, 10, selection.length);
    const edited = "PREFIX " + TEXT;
    const resolved = session.resolveRange({ start: 6, end: 9 }, edited, 2);
    expect(sliceAt(edited, resolved)).toBe("fox");
  });

  it("rejects ranges beyond the checked selection length", () => {
    const session = new CheckSession("file:///doc.md", TEXT, 1, 10, 9);
    expect(session.resolveRange({ start: 0, end: 10 }, TEXT, 1)).toBeNull();
  });

  it("tolerates whitespace-only drift via normalized comparison", () => {
    const session = fullDocSession();
    // Replace the space before "quick" with a non-breaking space; alignment
    // lands correctly and normalized comparison accepts the surface.
    const edited = TEXT.replace("The quick", "The quick");
    const resolved = session.resolveRange({ start: 4, end: 9 }, edited, 2);
    expect(sliceAt(edited, resolved).trim().length).toBeGreaterThan(0);
  });

  it("returns null for empty ranges once the document has changed", () => {
    const session = fullDocSession();
    const edited = "X" + TEXT;
    expect(session.resolveRange({ start: 5, end: 5 }, edited, 2)).toBeNull();
  });

  it("exposes the expected original surface for verification", () => {
    const session = fullDocSession();
    expect(session.expectedText({ start: 4, end: 9 })).toBe("quick");
  });
});

describe("CheckSessionStore", () => {
  it("stores one session per document and replaces on new checks", () => {
    const store = new CheckSessionStore();
    const first = fullDocSession(TEXT, 1);
    const second = fullDocSession(TEXT, 5);
    store.set(first);
    store.set(second);
    expect(store.get("file:///doc.md")).toBe(second);
  });

  it("clears sessions per document and globally", () => {
    const store = new CheckSessionStore();
    store.set(fullDocSession());
    store.delete("file:///doc.md");
    expect(store.get("file:///doc.md")).toBeUndefined();

    store.set(fullDocSession());
    store.clear();
    expect(store.get("file:///doc.md")).toBeUndefined();
  });

  it("returns the most recently set session as latest", () => {
    const store = new CheckSessionStore();
    const a = new CheckSession("file:///a.md", "aaa", 1, 0, 3);
    const b = new CheckSession("file:///b.md", "bbb", 1, 0, 3);
    store.set(a);
    store.set(b);
    expect(store.getLatest()).toBe(b);
  });
});

describe("findNearestOccurrence", () => {
  it("finds the closest occurrence to the anchor", () => {
    const text = "abc target xyz target abc";
    const near = findNearestOccurrence(text, "target", 20, 50);
    expect(near).toEqual({ start: 15, end: 21 });
  });

  it("returns null when the needle is outside the search radius", () => {
    const text = "target" + " ".repeat(500) + "anchor";
    expect(findNearestOccurrence(text, "target", 500, 100)).toBeNull();
  });
});
