import { afterEach, describe, expect, it } from "vitest";
import { _configStore, _resetVscodeMock } from "./mocks/vscode.js";
import { ExtensionConfig } from "../src/config.js";
import { API_BASE_URLS, ENABLED_AGENT_SLUGS } from "../src/constants.js";

describe("ExtensionConfig", () => {
  afterEach(() => _resetVscodeMock());

  it("defaults to the build-time environment (prod in tests) when unset", () => {
    const c = new ExtensionConfig();
    // Vitest runs without esbuild define, so BUILD_DEFAULT_ENVIRONMENT falls
    // through to "prod" — this also matches released-build behaviour.
    expect(c.getEnvironment()).toBe("prod");
    expect(c.getApiBaseUrl()).toBe(API_BASE_URLS.prod);
  });

  it("explicit 'dev' setting forces the dev base url", () => {
    _configStore["markupai.environment"] = "dev";
    const c = new ExtensionConfig();
    expect(c.getEnvironment()).toBe("dev");
    expect(c.getApiBaseUrl()).toBe(API_BASE_URLS.dev);
  });

  it("explicit 'prod' setting forces the prod base url", () => {
    _configStore["markupai.environment"] = "prod";
    const c = new ExtensionConfig();
    expect(c.getEnvironment()).toBe("prod");
    expect(c.getApiBaseUrl()).toBe(API_BASE_URLS.prod);
  });

  it("falls back to build-time default for unknown env values", () => {
    _configStore["markupai.environment"] = "staging";
    expect(new ExtensionConfig().getEnvironment()).toBe("prod");
  });

  it("returns compile-time agent list when no user override", () => {
    const c = new ExtensionConfig();
    expect(c.getEnabledAgents()).toEqual(ENABLED_AGENT_SLUGS);
  });

  it("intersects user-configured agents with compile-time allowlist", () => {
    _configStore["markupai.enabledAgents"] = ["style_agent", "bogus", "brand_voice"];
    const c = new ExtensionConfig();
    expect(c.getEnabledAgents()).toEqual(["style_agent", "brand_voice"]);
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
