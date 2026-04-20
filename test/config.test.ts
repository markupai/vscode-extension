import { afterEach, describe, expect, it } from "vitest";
import { _configStore, _resetVscodeMock } from "./mocks/vscode.js";
import { ExtensionConfig } from "../src/config.js";
import { API_BASE_URLS, ENABLED_AGENT_SLUGS } from "../src/constants.js";

describe("ExtensionConfig", () => {
  afterEach(() => _resetVscodeMock());

  it("defaults environment to dev with api.dev.markup.ai base url", () => {
    const c = new ExtensionConfig();
    expect(c.getEnvironment()).toBe("dev");
    expect(c.getApiBaseUrl()).toBe(API_BASE_URLS.dev);
  });

  it("switches to prod base url when environment is prod", () => {
    _configStore["markupai.environment"] = "prod";
    const c = new ExtensionConfig();
    expect(c.getEnvironment()).toBe("prod");
    expect(c.getApiBaseUrl()).toBe(API_BASE_URLS.prod);
  });

  it("falls back to 'dev' for garbage env values", () => {
    _configStore["markupai.environment"] = "staging";
    expect(new ExtensionConfig().getEnvironment()).toBe("dev");
  });

  it("returns compile-time agent list when no user override", () => {
    const c = new ExtensionConfig();
    expect(c.getEnabledAgents()).toEqual(ENABLED_AGENT_SLUGS);
  });

  it("intersects user-configured agents with compile-time allowlist", () => {
    _configStore["markupai.enabledAgents"] = ["style_agent", "bogus", "terminology"];
    const c = new ExtensionConfig();
    expect(c.getEnabledAgents()).toEqual(["style_agent", "terminology"]);
  });

  it("getLogLevel returns a valid level", () => {
    const c = new ExtensionConfig();
    expect(c.getLogLevel()).toBe("info");
    _configStore["markupai.logLevel"] = "debug";
    expect(new ExtensionConfig().getLogLevel()).toBe("debug");
    _configStore["markupai.logLevel"] = "nope";
    expect(new ExtensionConfig().getLogLevel()).toBe("info");
  });

  it("target id set/get round-trips", async () => {
    const c = new ExtensionConfig();
    expect(c.getStyleGuideTargetId()).toBe("");
    await c.setStyleGuideTargetId("tgt_1");
    expect(c.getStyleGuideTargetId()).toBe("tgt_1");
  });

  it("setEnabledAgents writes through to config store", async () => {
    const c = new ExtensionConfig();
    await c.setEnabledAgents(["style_agent"]);
    expect(_configStore["markupai.enabledAgents"]).toEqual(["style_agent"]);
  });
});
