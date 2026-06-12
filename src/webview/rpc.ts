/**
 * RPC message shapes shared between the sidebar webview script and the
 * extension host. The webview implements the adapter's PluginInterface as
 * stubs that forward each call here; the extension host executes the real
 * document operations and replies.
 */

export const RPC_REQUEST = "markupai.rpc";
export const RPC_RESULT = "markupai.rpcResult";
export const RPC_ERROR = "markupai.rpcError";

export interface RpcRequest {
  type: typeof RPC_REQUEST;
  id: number;
  method: string;
  args: unknown[];
}

export interface RpcResult {
  type: typeof RPC_RESULT;
  id: number;
  result: unknown;
}

export interface RpcErrorShape {
  name?: string;
  message?: string;
  [key: string]: unknown;
}

export interface RpcError {
  type: typeof RPC_ERROR;
  id: number;
  error: RpcErrorShape;
}

export type RpcResponse = RpcResult | RpcError;

export function isRpcRequest(value: unknown): value is RpcRequest {
  return isRecord(value) && value.type === RPC_REQUEST;
}

export function isRpcResponse(value: unknown): value is RpcResponse {
  return isRecord(value) && (value.type === RPC_RESULT || value.type === RPC_ERROR);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Bootstrap data the view provider injects into the webview HTML. */
export interface SidebarBootstrap {
  sidebarUrl: string;
  integrationName: string;
  integrationId: string;
  integrationVersion: string;
}
