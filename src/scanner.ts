import type * as vscode from "vscode";
import type { MarkupAIClient } from "./apiClient.js";
import { convertForAgents, detectKind } from "./converters/index.js";
import type { DiagnosticsManager } from "./diagnostics.js";
import type { Logger } from "./logger.js";
import { remapIssue, withIds } from "./issueRemapping.js";
import type { AgentConfig, ConvertedContent, Issue, IssueWithId } from "./types.js";
import type { AgentRegistry } from "./agentRegistry.js";

export interface ScanOptions {
  readonly uri: vscode.Uri;
  readonly text: string;
  readonly fileName: string;
  readonly agentSlugs: readonly string[];
  readonly agentConfig: AgentConfig;
  readonly onProgress?: (info: { agentSlug: string; issues: readonly IssueWithId[] }) => void;
  readonly signal?: AbortSignal;
}

export interface ScanResult {
  readonly totalIssues: number;
  readonly perAgent: Record<string, IssueWithId[]>;
  readonly errors: readonly string[];
}

/**
 * Runs a scan for the requested agents against a single document.
 *
 * Two buckets are dispatched in parallel to match the server's content-
 * profile split:
 *   - style_agent + DITA source → raw DITA (`content_profile_id: "dita"`)
 *   - everything else → markdown (`content_profile_id: "markdown"`)
 *
 * Issues arriving via SSE are:
 *   1. remapped from markdown offsets back to source offsets, and
 *   2. pushed to DiagnosticsManager under their agent slug.
 */
export class Scanner {
  constructor(
    private readonly client: MarkupAIClient,
    private readonly registry: AgentRegistry,
    private readonly diagnostics: DiagnosticsManager,
    private readonly logger: Logger,
  ) {}

  async scan(opts: ScanOptions): Promise<ScanResult> {
    const kind = detectKind(opts.fileName);
    const isDita = kind === "dita";
    const requested = this.resolveAgents(opts.agentSlugs);
    if (!requested.length) {
      this.logger.warn("scan: no enabled agents matched the request");
      return { totalIssues: 0, perAgent: {}, errors: ["No enabled agents are available."] };
    }

    const hasStyle = requested.some((a) => a.slug === "style_agent");
    const buckets = this.buildBuckets(requested, isDita, hasStyle);

    const perAgent: Record<string, IssueWithId[]> = {};
    const errors: string[] = [];
    const mutable = { total: 0, perAgent, errors };

    await Promise.all(
      buckets.map((bucket) =>
        this.runBucket(opts, bucket, mutable).catch((err: unknown) => {
          const msg = toErrorMessage(err);
          this.logger.error("bucket failed", msg);
          mutable.errors.push(msg);
        }),
      ),
    );
    return { totalIssues: mutable.total, perAgent, errors };
  }

  private resolveAgents(slugs: readonly string[]): { slug: string; internalId: string }[] {
    return slugs
      .map((slug) => this.registry.getBySlug(slug))
      .filter((a): a is NonNullable<typeof a> => Boolean(a))
      .map((a) => ({ slug: a.slug, internalId: a.internalId }));
  }

  private buildBuckets(
    agents: { slug: string; internalId: string }[],
    isDita: boolean,
    hasStyle: boolean,
  ): { agents: typeof agents; forStyleAgent: boolean }[] {
    if (!isDita || !hasStyle) {
      // Single bucket: everything uses markdown (style_agent too).
      return [{ agents, forStyleAgent: false }];
    }
    const style = agents.filter((a) => a.slug === "style_agent");
    const others = agents.filter((a) => a.slug !== "style_agent");
    const buckets: { agents: typeof agents; forStyleAgent: boolean }[] = [];
    if (style.length) buckets.push({ agents: style, forStyleAgent: true });
    if (others.length) buckets.push({ agents: others, forStyleAgent: false });
    return buckets;
  }

  private async runBucket(
    opts: ScanOptions,
    bucket: { agents: { slug: string; internalId: string }[]; forStyleAgent: boolean },
    mutable: { total: number; perAgent: Record<string, IssueWithId[]>; errors: string[] },
  ): Promise<void> {
    const converted = convertForAgents(opts.text, opts.fileName, bucket.forStyleAgent);
    const run = await this.client.runAgents(
      {
        internalIds: bucket.agents.map((a) => a.internalId),
        text: converted.markdown,
        contentProfile: converted.contentProfile,
        agentConfig: opts.agentConfig,
        documentName: opts.fileName,
        documentRef: opts.uri.toString(),
      },
      opts.signal,
    );
    const workflowId = run.workflow_id;
    this.logger.info(
      `scan: workflow=${workflowId} agents=[${bucket.agents.map((a) => a.slug).join(", ")}] profile=${converted.contentProfile}`,
    );

    const byInternalId = new Map(bucket.agents.map((a) => [a.internalId, a.slug]));
    const byName = new Map(bucket.agents.map((a) => [a.slug, a.slug]));

    for await (const event of this.client.streamWorkflow(workflowId, opts.signal)) {
      if (event.type === "completion") break;
      if (event.type === "error") {
        mutable.errors.push(event.error);
        this.logger.error("sse error:", event.error);
        break;
      }
      if (event.type !== "agent_result") continue;
      if (!event.success) {
        mutable.errors.push(`${event.agent_name}: ${event.error ?? "failed"}`);
        continue;
      }
      const slug =
        byInternalId.get(event.agent_name) ?? byName.get(event.agent_name) ?? event.agent_name;
      const rawIssues = event.result?.issues ?? [];
      const remapped = rawIssues.map((i) => remapSingle(i, converted));
      const withId = withIds(remapped);
      mutable.total += withId.length;
      mutable.perAgent[slug] = [...(mutable.perAgent[slug] ?? []), ...withId];
      this.diagnostics.setIssuesForAgent(opts.uri, slug, mutable.perAgent[slug]);
      opts.onProgress?.({ agentSlug: slug, issues: withId });
    }
  }
}

function remapSingle(issue: Issue, converted: ConvertedContent): Issue {
  return remapIssue(issue, converted.offsetMap);
}

function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return JSON.stringify(err);
}
