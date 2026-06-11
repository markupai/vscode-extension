import {
  INTEGRATION_ID,
  MAX_TEXT_LENGTH,
  POLL_INTERVAL_MS,
  POLL_TIMEOUT_MS,
  USER_MESSAGE_PREFIX,
} from "./constants";

// ============================================================================
// Style Agent API Types (https://api.markup.ai/docs)
// ============================================================================

export type StyleAgentMode = "disabled" | "enabled" | "enabled_terminology";

export type WorkflowStatus = "running" | "completed" | "failed" | "timed_out" | "cancelled";

export interface StyleAgentConfig {
  is_acrolinx_classic: boolean;
  style_agent: StyleAgentMode;
  /** When false, results carry no numeric scores — risk levels only. */
  style_agent_numeric_scoring: boolean;
}

export interface StyleGuideSummary {
  id: string;
  display_name: string;
  is_default: boolean;
  enabled: boolean;
  description?: string | null;
  language?: string | null;
  language_name?: string | null;
  language_variant?: string | null;
  language_variant_name?: string | null;
}

export interface IssuePosition {
  start?: number;
  end?: number;
  text?: string;
}

export interface StyleAgentIssue {
  id?: string;
  agent?: string;
  severity?: string;
  category?: string;
  explanation?: string;
  position?: IssuePosition;
  suggestion?: string | null;
  suggestions?: string[];
  guideline_name?: string;
  context_surface?: string;
  confidence?: number;
  read_only?: boolean;
}

/** Readability / style guide metadata; null when numeric scoring is off. */
export interface StyleAgentAnalysis {
  styleGuideId?: string | null;
  styleGuideDisplayName?: string | null;
  contentProfileId?: string | null;
  contentProfileDisplayName?: string | null;
  words?: number | null;
  sentences?: number | null;
  clarityIndex?: number | null;
  informalityIndex?: number | null;
  livelinessIndex?: number | null;
  fleschReadingEase?: number | null;
  [key: string]: unknown;
}

/** Issues and quality scores flow through untyped (`extra="allow"`). */
export interface StyleAgentResult {
  issues?: StyleAgentIssue[];
  analysis?: StyleAgentAnalysis | null;
  [key: string]: unknown;
}

export interface StyleAgentWorkflow {
  workflow_id: string;
  status: WorkflowStatus;
  result?: StyleAgentResult | null;
  document_ref?: string | null;
  started_at?: string;
  completed_at?: string | null;
}

export interface RunCheckRequest {
  text: string;
  styleGuideId?: string;
  documentName?: string;
  documentRef?: string;
}

// ============================================================================
// Errors
// ============================================================================

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** 401/403 — the token is missing, expired, or lacks permissions. */
export class AuthError extends ApiError {
  constructor(message: string, status: number) {
    super(message, status);
    this.name = "AuthError";
  }
}

// ============================================================================
// Client
// ============================================================================

export interface StyleAgentClientOptions {
  baseUrl: string;
  /** Resolves the current bearer token (access token or API key). */
  getToken: () => Promise<string | undefined>;
  /** Exposed for tests — defaults to the platform `fetch`. */
  fetchImpl?: typeof fetch;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
}

/**
 * Direct fetch-based client for the Style Agent API. Web-compatible:
 * uses only platform `fetch`, no Node APIs.
 */
export class StyleAgentClient {
  private readonly baseUrl: string;
  private readonly getToken: () => Promise<string | undefined>;
  private readonly fetchImpl: typeof fetch;
  private readonly pollIntervalMs: number;
  private readonly pollTimeoutMs: number;

  constructor(options: StyleAgentClientOptions) {
    this.baseUrl = stripTrailingSlash(options.baseUrl);
    this.getToken = options.getToken;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.pollIntervalMs = options.pollIntervalMs ?? POLL_INTERVAL_MS;
    this.pollTimeoutMs = options.pollTimeoutMs ?? POLL_TIMEOUT_MS;
  }

  /** Org-level config: style agent mode and whether numeric scoring is on. */
  async getConfig(): Promise<StyleAgentConfig> {
    return (await this.request("/style-agent/config")) as StyleAgentConfig;
  }

  async listStyleGuides(): Promise<StyleGuideSummary[]> {
    let guides: StyleGuideSummary[];
    try {
      guides = (await this.request("/style-agent/style-guides")) as StyleGuideSummary[];
    } catch (error) {
      // Prod does not serve /style-agent/style-guides yet; fall back to
      // the older /style-agent/targets endpoint (same response shape).
      if (error instanceof ApiError && error.status === 404 && !(error instanceof AuthError)) {
        guides = (await this.request("/style-agent/targets")) as StyleGuideSummary[];
      } else {
        throw error;
      }
    }
    return guides.filter((g) => g.enabled);
  }

  /**
   * Run a Style Agent check and poll until the workflow reaches a
   * terminal status. Returns the completed workflow.
   */
  async runCheck(req: RunCheckRequest): Promise<StyleAgentWorkflow> {
    if (req.text.length > MAX_TEXT_LENGTH) {
      throw new Error(
        `${USER_MESSAGE_PREFIX}document is too large to check ` +
          `(${String(req.text.length)} characters; limit is ${String(MAX_TEXT_LENGTH)}).`,
      );
    }

    const body: Record<string, unknown> = { text: req.text };
    if (req.styleGuideId) {
      // `target_id` is the deprecated alias of `style_guide_id`, but it is
      // the only name the prod API accepts today (dev accepts both, prod
      // 422s on style_guide_id). Switch once prod supports the new name.
      body.target_id = req.styleGuideId;
    }
    if (req.documentName) {
      body.document_name = req.documentName;
    }
    if (req.documentRef) {
      body.document_ref = req.documentRef;
    }

    const started = (await this.request("/style-agent/run?wait=false", {
      method: "POST",
      body: JSON.stringify(body),
    })) as StyleAgentWorkflow;

    if (isTerminal(started.status)) {
      return this.assertCompleted(started);
    }

    return this.pollWorkflow(started.workflow_id);
  }

  private async pollWorkflow(workflowId: string): Promise<StyleAgentWorkflow> {
    const deadline = Date.now() + this.pollTimeoutMs;

    while (Date.now() < deadline) {
      await delay(this.pollIntervalMs);

      let workflow: StyleAgentWorkflow;
      try {
        workflow = (await this.request(
          `/style-agent/workflows/${encodeURIComponent(workflowId)}`,
        )) as StyleAgentWorkflow;
      } catch (error) {
        // The workflow record can briefly 404 right after creation.
        if (error instanceof ApiError && error.status === 404 && !(error instanceof AuthError)) {
          continue;
        }
        throw error;
      }

      if (isTerminal(workflow.status)) {
        return this.assertCompleted(workflow);
      }
    }

    throw new Error(`${USER_MESSAGE_PREFIX}content check timed out. Please try again.`);
  }

  private assertCompleted(workflow: StyleAgentWorkflow): StyleAgentWorkflow {
    if (workflow.status !== "completed") {
      throw new Error(`${USER_MESSAGE_PREFIX}content check ${workflow.status.replace("_", " ")}.`);
    }
    return workflow;
  }

  private async request(path: string, init?: { method?: string; body?: string }): Promise<unknown> {
    const token = await this.getToken();
    if (!token) {
      throw new AuthError(`${USER_MESSAGE_PREFIX}not signed in.`, 401);
    }

    // Note: no x-integration-version header — the API enforces a global
    // minimum version (426) that predates this integration. Reintroduce it
    // once a dedicated vscode integration is registered server-side.
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "x-integration-id": INTEGRATION_ID,
    };
    if (init?.body) {
      headers["Content-Type"] = "application/json";
    }

    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: init?.method ?? "GET",
      headers,
      ...(init?.body ? { body: init.body } : {}),
    });

    if (!response.ok) {
      const message = await extractErrorMessage(response);
      if (response.status === 401 || response.status === 403) {
        throw new AuthError(message, response.status);
      }
      throw new ApiError(message, response.status);
    }

    return response.json();
  }
}

// ============================================================================
// Helpers
// ============================================================================

const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  "completed",
  "failed",
  "timed_out",
  "cancelled",
]);

function isTerminal(status: WorkflowStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

async function extractErrorMessage(response: Response): Promise<string> {
  let detail = "";
  try {
    const data = (await response.json()) as Record<string, unknown>;
    for (const key of ["message", "error", "detail"]) {
      if (typeof data[key] === "string") {
        detail = data[key];
        break;
      }
    }
  } catch {
    // Non-JSON error body — fall through to the generic message.
  }
  const suffix = detail ? ` — ${detail}` : "";
  return `${USER_MESSAGE_PREFIX}request failed (${String(response.status)})${suffix}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Remove trailing `/` chars. Linear, no regex backtracking. */
function stripTrailingSlash(s: string): string {
  let end = s.length;
  while (end > 0 && s[end - 1] === "/") {
    end--;
  }
  return s.slice(0, end);
}
