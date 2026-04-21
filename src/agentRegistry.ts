import { ENABLED_AGENT_SLUGS } from "./constants.js";
import type { MarkupAIClient } from "./apiClient.js";
import type { Agent, AgentCategory, RawAgentRecord } from "./types.js";

const NON_SELECTABLE = new Set(["parallel_executor", "task_orchestrator"]);

const CATEGORY_VALUES: readonly AgentCategory[] = [
  "accuracy",
  "compliance",
  "brand",
  "geo",
  "integrity",
  "other",
];

/**
 * Discovers agents from the server and filters them to the compile-time
 * allowlist (ENABLED_AGENT_SLUGS). Agents disabled on the platform or
 * removed from the allowlist simply don't appear in the result.
 */
export class AgentRegistry {
  private agents: readonly Agent[] = [];

  constructor(private readonly client: MarkupAIClient) {}

  getAll(): readonly Agent[] {
    return this.agents;
  }

  getBySlug(slug: string): Agent | undefined {
    return this.agents.find((a) => a.slug === slug);
  }

  async refresh(): Promise<readonly Agent[]> {
    const response = await this.client.listAgents();
    const allow = new Set(ENABLED_AGENT_SLUGS);
    this.agents = response.agents
      .map(normalize)
      .filter((a): a is Agent => a !== null)
      .filter((a) => !NON_SELECTABLE.has(a.slug))
      .filter((a) => allow.has(a.slug));
    return this.agents;
  }
}

export function normalize(raw: RawAgentRecord): Agent | null {
  const slug = deriveSlug(raw);
  if (!slug) return null;
  const ui = raw.metadata?.ui ?? {};
  const inputSchema = raw.input_schema?.properties ?? raw.metadata?.input_schema?.properties ?? {};
  const configKeys = Object.keys(inputSchema).filter((k) => k !== "text");
  return {
    slug,
    internalId: raw.id,
    displayName: ui.title ?? raw.name,
    description: ui.description ?? raw.description ?? "",
    category: toCategory(ui.category),
    configKeys,
  };
}

function deriveSlug(raw: RawAgentRecord): string {
  // The server exposes a human-readable `name` (e.g. "style_agent",
  // "Style Agent", or "Terminology"). Normalise to snake_case so the
  // UI's compile-time allowlist can match reliably.
  const name = raw.name.trim();
  if (!name) return "";
  // Two anchored passes — no alternation, no backtracking ambiguity.
  return name
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "_")
    .replace(/^_+/, "")
    .replace(/_+$/, "");
}

function toCategory(value: string | undefined): AgentCategory {
  if (!value) return "other";
  const lower = value.toLowerCase();
  return (CATEGORY_VALUES as readonly string[]).includes(lower)
    ? (lower as AgentCategory)
    : "other";
}
