import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentRegistry, normalize } from "../src/agentRegistry.js";
import type { MarkupAIClient } from "../src/apiClient.js";
import type { RawAgentRecord } from "../src/types.js";

function makeClient(records: RawAgentRecord[]): MarkupAIClient {
  return {
    listAgents: vi.fn(async () => ({ agents: records })),
  } as unknown as MarkupAIClient;
}

describe("normalize", () => {
  it("converts server name to snake_case slug", () => {
    const a = normalize({ id: "ag_1", name: "Style Agent" });
    expect(a?.slug).toBe("style_agent");
  });

  it("reads ui.title/description/category when present", () => {
    const a = normalize({
      id: "ag_2",
      name: "terminology",
      input_schema: { properties: { text: {}, domain_ids: {} } },
      metadata: {
        ui: { title: "Terminology", description: "x", category: "brand" },
      },
    });
    expect(a?.displayName).toBe("Terminology");
    expect(a?.category).toBe("brand");
    expect(a?.configKeys).toEqual(["domain_ids"]);
  });

  it("defaults category to 'other' when unknown", () => {
    const a = normalize({ id: "ag_x", name: "foo", metadata: { ui: { category: "weird" } } });
    expect(a?.category).toBe("other");
  });

  it("returns null for empty name", () => {
    expect(normalize({ id: "ag_y", name: "   " })).toBeNull();
  });
});

describe("AgentRegistry", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("refresh intersects server agents with compile-time allowlist", async () => {
    const client = makeClient([
      { id: "ag_1", name: "style_agent" },
      { id: "ag_2", name: "terminology" },
      // not in allowlist:
      { id: "ag_3", name: "invented_agent" },
      // non-selectable sentinel:
      { id: "ag_4", name: "parallel_executor" },
    ]);
    const registry = new AgentRegistry(client);
    const agents = await registry.refresh();
    const slugs = agents.map((a) => a.slug);
    expect(slugs).toContain("style_agent");
    expect(slugs).toContain("terminology");
    expect(slugs).not.toContain("invented_agent");
    expect(slugs).not.toContain("parallel_executor");
  });

  it("getBySlug returns the right agent", async () => {
    const client = makeClient([{ id: "ag_1", name: "style_agent" }]);
    const registry = new AgentRegistry(client);
    await registry.refresh();
    expect(registry.getBySlug("style_agent")?.internalId).toBe("ag_1");
    expect(registry.getBySlug("missing")).toBeUndefined();
  });
});
