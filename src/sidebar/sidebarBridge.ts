import * as vscode from "vscode";
import { SidebarRpcHandler } from "./sidebarViewProvider";

/**
 * Extension-host implementation of the sidebar's PluginInterface calls.
 * Auth hand-off is implemented here; document operations (content,
 * selection, replacement) are provided by the document bridge.
 */
export class SidebarBridge implements SidebarRpcHandler {
  async handle(method: string, args: unknown[]): Promise<unknown> {
    switch (method) {
      case "openAuthUrl": {
        const url = args[0];
        if (typeof url !== "string" || !/^https:\/\//.test(url)) {
          throw new Error("Invalid auth URL");
        }
        await vscode.env.openExternal(vscode.Uri.parse(url));
        return undefined;
      }
      default:
        throw new Error(`Unsupported sidebar request: ${method}`);
    }
  }
}
