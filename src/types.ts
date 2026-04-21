// ===================================================================
// MarkupAI extension — shared types
// ===================================================================

export type Environment = "dev" | "prod";

export type LogLevel = "debug" | "info" | "warn" | "error";

export type IssueSeverity = "low" | "medium" | "high" | "critical";

// ===================================================================
// Agents
// ===================================================================

export type AgentCategory = "accuracy" | "compliance" | "brand" | "geo" | "integrity" | "other";

/** A single agent as exposed to the UI and the orchestrator. */
export interface Agent {
  /** Slug used in URLs, config, and the UI (e.g. "style_agent"). */
  readonly slug: string;
  /** Internal id returned by the server (e.g. "ag_abc123"). */
  readonly internalId: string;
  readonly displayName: string;
  readonly description: string;
  readonly category: AgentCategory;
  /** Config keys the agent accepts (e.g. ["target_id"]). */
  readonly configKeys: readonly string[];
}

/** Raw shape of an agent record returned from `/agents/list`. */
export interface RawAgentRecord {
  readonly id: string;
  readonly name: string;
  readonly description?: string | null;
  readonly input_schema?: {
    readonly properties?: Record<string, unknown>;
  };
  readonly metadata?: {
    readonly input_schema?: {
      readonly properties?: Record<string, unknown>;
    };
    readonly ui?: {
      readonly title?: string;
      readonly description?: string;
      readonly category?: string;
    };
  };
}

// ===================================================================
// Issues
// ===================================================================

export interface IssuePosition {
  readonly start: number;
  readonly end: number;
  readonly sentence?: string;
  readonly contextBefore?: string;
  readonly contextAfter?: string;
}

/** Issue emitted by an agent. */
export interface Issue {
  readonly agent: string;
  readonly agentName?: string;
  readonly category?: string;
  readonly confidence: number;
  readonly severity: IssueSeverity;
  readonly explanation: string;
  readonly suggestion?: string;
  readonly position: IssuePosition;
}

/** Issue with a stable local id, used for de-duplication and tracking. */
export interface IssueWithId extends Issue {
  readonly id: string;
}

// ===================================================================
// Agent configuration
// ===================================================================

export interface AgentConfig {
  readonly target_id?: string;
  readonly domain_ids?: readonly string[];
  readonly persona_id?: string;
}

// ===================================================================
// API responses
// ===================================================================

export interface AgentRunResponse {
  readonly workflow_id: string;
  readonly status?: string;
}

export interface AgentListResponse {
  readonly agents: readonly RawAgentRecord[];
}

// ===================================================================
// Targets (style-guide / language-service targets)
// ===================================================================

/**
 * Shape returned by `GET /internal/targets`. A "target" is a
 * style-guide binding in the language service — `id` is what the
 * style agent expects as `target_id`.
 */
export interface Target {
  readonly id: string;
  readonly display_name: string;
  readonly is_default: boolean;
  readonly enabled: boolean;
}

// ===================================================================
// SSE events streamed by `/agents/workflows/{wf}/stream`
// ===================================================================

export interface SSEAgentResultEvent {
  readonly type: "agent_result";
  readonly agent_name: string;
  readonly success: boolean;
  readonly error?: string;
  readonly result?: {
    readonly issues?: readonly Issue[];
    readonly quality?: unknown;
  };
}

export interface SSEStatusEvent {
  readonly type: "status";
  readonly status: string;
}

export interface SSEErrorEvent {
  readonly type: "error";
  readonly error: string;
}

export interface SSECompletionEvent {
  readonly type: "completion";
}

export type SSEEvent = SSEAgentResultEvent | SSEStatusEvent | SSEErrorEvent | SSECompletionEvent;

// ===================================================================
// Content conversion
// ===================================================================

/**
 * Result of converting a source document to markdown.
 * `offsetMap` lets us translate agent-reported offsets (in the markdown
 * the agent saw) back to offsets in the original source text.
 */
export interface ConvertedContent {
  readonly markdown: string;
  readonly originalText: string;
  readonly offsetMap: OffsetMap;
  readonly contentProfile: "markdown" | "dita";
}

/** Sparse pair list: sorted pairs `{ md, src }` of matching offsets. */
export interface OffsetMap {
  readonly pairs: readonly OffsetPair[];
}

export interface OffsetPair {
  readonly md: number;
  readonly src: number;
}

// ===================================================================
// Scan results
// ===================================================================

export interface ScanRequest {
  readonly uri: string;
  readonly documentText: string;
  readonly converted: ConvertedContent;
  readonly agentSlugs: readonly string[];
  readonly agentConfig: AgentConfig;
}

export interface ScanProgress {
  readonly uri: string;
  readonly agentSlug: string;
  readonly issues: readonly IssueWithId[];
  readonly done: boolean;
  readonly error?: string;
}
