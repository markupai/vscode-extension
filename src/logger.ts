import * as vscode from "vscode";
import { EXTENSION_NAME } from "./constants.js";
import type { LogLevel } from "./types.js";

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/**
 * Minimal logger that writes to a VS Code OutputChannel and respects the
 * `markupai.logLevel` setting. Safe to use in both desktop and web builds.
 */
export class Logger {
  private readonly channel: vscode.OutputChannel;
  private level: LogLevel = "info";

  constructor(channel?: vscode.OutputChannel) {
    this.channel = channel ?? vscode.window.createOutputChannel(EXTENSION_NAME);
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  debug(...args: unknown[]): void {
    this.write("debug", args);
  }

  info(...args: unknown[]): void {
    this.write("info", args);
  }

  warn(...args: unknown[]): void {
    this.write("warn", args);
  }

  error(...args: unknown[]): void {
    this.write("error", args);
  }

  show(): void {
    this.channel.show(true);
  }

  dispose(): void {
    this.channel.dispose();
  }

  private write(level: LogLevel, args: unknown[]): void {
    if (ORDER[level] < ORDER[this.level]) return;
    const ts = new Date().toISOString();
    const prefix = `[${ts}] [${level.toUpperCase()}]`;
    const body = args
      .map((a) => {
        if (a instanceof Error) return `${a.message}\n${a.stack ?? ""}`;
        if (typeof a === "string") return a;
        try {
          return JSON.stringify(a);
        } catch {
          return String(a);
        }
      })
      .join(" ");
    this.channel.appendLine(`${prefix} ${body}`);
  }
}
