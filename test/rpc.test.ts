import { describe, it, expect } from "vitest";
import {
  isRpcRequest,
  isRpcResponse,
  RPC_ERROR,
  RPC_REQUEST,
  RPC_RESULT,
} from "../src/webview/rpc";

describe("rpc message guards", () => {
  it("accepts well-formed requests", () => {
    expect(isRpcRequest({ type: RPC_REQUEST, id: 1, method: "getContent", args: [] })).toBe(true);
  });

  it("rejects non-request values", () => {
    expect(isRpcRequest(null)).toBe(false);
    expect(isRpcRequest("markupai.rpc")).toBe(false);
    expect(isRpcRequest({ type: "other" })).toBe(false);
  });

  it("accepts results and errors as responses", () => {
    expect(isRpcResponse({ type: RPC_RESULT, id: 1, result: "x" })).toBe(true);
    expect(isRpcResponse({ type: RPC_ERROR, id: 1, error: { message: "boom" } })).toBe(true);
  });

  it("rejects non-response values", () => {
    expect(isRpcResponse(undefined)).toBe(false);
    expect(isRpcResponse({ type: RPC_REQUEST, id: 1 })).toBe(false);
  });
});
