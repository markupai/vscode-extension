import { describe, expect, it } from "vitest";
import { Logger } from "../src/logger.js";

function makeChannel(): { lines: string[]; channel: any } {
  const lines: string[] = [];
  return {
    lines,
    channel: {
      name: "test",
      appendLine(s: string) {
        lines.push(s);
      },
      append(s: string) {
        lines.push(s);
      },
      show() {
        /* noop */
      },
      dispose() {
        /* noop */
      },
    },
  };
}

describe("Logger", () => {
  it("emits info and error by default", () => {
    const { lines, channel } = makeChannel();
    const l = new Logger(channel);
    l.info("hello");
    l.error("boom");
    expect(lines.some((s) => s.includes("INFO] hello"))).toBe(true);
    expect(lines.some((s) => s.includes("ERROR] boom"))).toBe(true);
  });

  it("suppresses debug when level is info", () => {
    const { lines, channel } = makeChannel();
    new Logger(channel).debug("should not appear");
    expect(lines.some((s) => s.includes("DEBUG"))).toBe(false);
  });

  it("emits debug after setLevel('debug')", () => {
    const { lines, channel } = makeChannel();
    const l = new Logger(channel);
    l.setLevel("debug");
    l.debug("hi");
    expect(lines.some((s) => s.includes("DEBUG] hi"))).toBe(true);
  });

  it("serializes Error instances with their stack", () => {
    const { lines, channel } = makeChannel();
    new Logger(channel).error(new Error("xx"));
    expect(lines.some((s) => s.includes("xx"))).toBe(true);
  });

  it("serializes objects with JSON.stringify", () => {
    const { lines, channel } = makeChannel();
    new Logger(channel).warn({ a: 1 });
    expect(lines.some((s) => s.includes('{"a":1}'))).toBe(true);
  });

  it("falls back to String(value) for un-stringifiable objects", () => {
    const { lines, channel } = makeChannel();
    const circ: any = {};
    circ.self = circ;
    new Logger(channel).info(circ);
    expect(lines.some((s) => s.includes("[object Object]"))).toBe(true);
  });

  it("show() and dispose() don't throw", () => {
    const { channel } = makeChannel();
    const l = new Logger(channel);
    expect(() => {
      l.show();
      l.dispose();
    }).not.toThrow();
  });
});
