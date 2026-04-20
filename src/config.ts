import * as vscode from "vscode";
import { API_BASE_URLS, BUILD_DEFAULT_ENVIRONMENT, ENABLED_AGENT_SLUGS } from "./constants.js";
import type { Environment, LogLevel } from "./types.js";

const SECTION = "markupai";

/**
 * Typed accessor for VS Code workspace/user settings under the `markupai.*`
 * namespace. Reads are live — the VS Code configuration system handles
 * change events via `onDidChangeConfiguration`.
 */
export class ExtensionConfig {
  private get cfg(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration(SECTION);
  }

  getEnvironment(): Environment {
    // "default" here means "fall back to the build-time default". Users
    // who want to override the shipped build can pick dev/prod explicitly.
    const value = this.cfg.get<string>("environment", "default");
    if (value === "dev" || value === "prod") return value;
    return BUILD_DEFAULT_ENVIRONMENT;
  }

  getApiBaseUrl(): string {
    return API_BASE_URLS[this.getEnvironment()];
  }

  getLogLevel(): LogLevel {
    const raw = this.cfg.get<string>("logLevel", "info");
    if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") {
      return raw;
    }
    return "info";
  }

  getStyleGuideTargetId(): string {
    return (this.cfg.get<string>("styleGuideTargetId") ?? "").trim();
  }

  async setStyleGuideTargetId(id: string): Promise<void> {
    await this.cfg.update("styleGuideTargetId", id, vscode.ConfigurationTarget.Global);
  }

  /**
   * User-configured agent slugs. When unset (empty), the compile-time
   * allowlist is returned. Only slugs present in the compile-time list
   * are ever returned — the allowlist is the upper bound.
   */
  getEnabledAgents(): readonly string[] {
    const user = this.cfg.get<string[]>("enabledAgents", []);
    if (!user.length) return ENABLED_AGENT_SLUGS;
    const allow = new Set(ENABLED_AGENT_SLUGS);
    return user.filter((s) => allow.has(s));
  }

  async setEnabledAgents(slugs: readonly string[]): Promise<void> {
    await this.cfg.update("enabledAgents", [...slugs], vscode.ConfigurationTarget.Global);
  }
}
