import { TextOffsetMapper } from "./offsetMapper";
import { StyleAgentIssue, StyleAgentResult, StyleAgentWorkflow } from "./styleAgentApi";
import { CheckResult, ContentIssue, IssueSeverity, RiskSummary } from "./types";

/**
 * Maps a completed Style Agent workflow onto the extension's domain model.
 *
 * Issue positions come back as character offsets into the submitted text
 * with the flagged surface in `position.text`; offsets are verified against
 * the document and repaired via code-point conversion / nearby search for
 * Unicode edge cases (emoji and other non-BMP characters).
 */
export function toCheckResult(workflow: StyleAgentWorkflow, text: string): CheckResult {
  const result: StyleAgentResult = workflow.result ?? {};
  const rawIssues = result.issues ?? [];
  const mapper = new TextOffsetMapper(text);

  const issues: ContentIssue[] = [];
  for (let i = 0; i < rawIssues.length; i++) {
    const issue = mapIssue(rawIssues[i], i, text, mapper);
    if (issue) {
      issues.push(issue);
    }
  }

  const score = extractScore(result);
  return {
    issues,
    assessment: {
      risk: summarizeRisk(issues),
      ...(score === undefined ? {} : { score }),
    },
  };
}

export function summarizeRisk(issues: readonly ContentIssue[]): RiskSummary {
  const risk: RiskSummary = { high: 0, medium: 0, low: 0, total: issues.length };
  for (const issue of issues) {
    risk[issue.severity]++;
  }
  return risk;
}

function mapIssue(
  raw: StyleAgentIssue,
  index: number,
  text: string,
  mapper: TextOffsetMapper,
): ContentIssue | null {
  const originalText = raw.position?.text ?? "";
  const range = resolveRange(raw, text, mapper, originalText);
  if (!range) {
    return null;
  }

  const category = raw.category?.trim() || "Style";
  const message =
    raw.explanation?.trim() ||
    raw.guideline_name?.trim() ||
    `${category}: review "${originalText}"`;

  return {
    id: raw.id ?? `issue-${String(index)}`,
    startIndex: range.start,
    endIndex: range.end,
    category,
    ...(raw.guideline_name ? { guidelineName: raw.guideline_name } : {}),
    message,
    suggestion: raw.suggestion ?? raw.suggestions?.[0] ?? "",
    originalText: originalText || text.slice(range.start, range.end),
    severity: normalizeSeverity(raw.severity),
  };
}

function resolveRange(
  raw: StyleAgentIssue,
  text: string,
  mapper: TextOffsetMapper,
  originalText: string,
): { start: number; end: number } | null {
  const start = raw.position?.start;
  const end = raw.position?.end;
  if (typeof start !== "number" || typeof end !== "number" || end < start) {
    return null;
  }

  // Fast path: the reported offsets line up with the document text.
  if (!originalText || text.slice(start, end) === originalText) {
    return { start, end };
  }

  // The API may count code points where JavaScript counts UTF-16 units.
  const convertedStart = mapper.codePointOffsetToStringIndex(start);
  if (text.startsWith(originalText, convertedStart)) {
    return { start: convertedStart, end: convertedStart + originalText.length };
  }

  return mapper.findNearbyText(originalText, convertedStart, 50);
}

function normalizeSeverity(severity: string | undefined): IssueSeverity {
  return severity === "high" || severity === "medium" || severity === "low" ? severity : "low";
}

/**
 * Quality scores flow through the result untyped and only when the
 * organization has numeric scoring enabled. Look in the known spots.
 */
function extractScore(result: StyleAgentResult): number | undefined {
  const direct = readScore(result["quality"]);
  if (direct !== undefined) {
    return direct;
  }
  const scores = result["scores"];
  if (scores && typeof scores === "object") {
    return readScore((scores as Record<string, unknown>)["quality"]);
  }
  return undefined;
}

function readScore(quality: unknown): number | undefined {
  if (
    quality &&
    typeof quality === "object" &&
    "score" in quality &&
    typeof quality.score === "number"
  ) {
    return (quality as { score: number }).score;
  }
  return undefined;
}
