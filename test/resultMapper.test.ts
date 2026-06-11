import { describe, it, expect } from "vitest";
import { toCheckResult, summarizeRisk } from "../src/resultMapper";
import { StyleAgentWorkflow } from "../src/styleAgentApi";
import { ContentIssue } from "../src/types";

function workflow(result: StyleAgentWorkflow["result"]): StyleAgentWorkflow {
  return { workflow_id: "agw_1", status: "completed", result };
}

const TEXT = "this are a test sentance with mistakes.";

describe("toCheckResult", () => {
  it("maps issues with exact offsets", () => {
    const result = toCheckResult(
      workflow({
        issues: [
          {
            id: "iss_1",
            severity: "high",
            category: "Spelling and Grammar",
            explanation: "Capitalize the first word.",
            position: { start: 0, end: 4, text: "this" },
            suggestion: "This",
            suggestions: ["This"],
            guideline_name: "Capitalize sentences",
          },
        ],
      }),
      TEXT,
    );

    expect(result.issues).toHaveLength(1);
    const issue = result.issues[0];
    expect(issue.id).toBe("iss_1");
    expect(issue.startIndex).toBe(0);
    expect(issue.endIndex).toBe(4);
    expect(issue.category).toBe("Spelling and Grammar");
    expect(issue.message).toBe("Capitalize the first word.");
    expect(issue.suggestion).toBe("This");
    expect(issue.originalText).toBe("this");
    expect(issue.severity).toBe("high");
    expect(issue.guidelineName).toBe("Capitalize sentences");
    expect(result.assessment.risk).toEqual({ high: 1, medium: 0, low: 0, total: 1 });
    expect(result.assessment.score).toBeUndefined();
  });

  it("repairs code-point offsets for documents with emoji", () => {
    const text = "🚀🚀 this are wrong.";
    // "this" starts at UTF-16 index 5 but code-point offset 3.
    const result = toCheckResult(
      workflow({
        issues: [
          {
            severity: "medium",
            category: "Grammar",
            position: { start: 3, end: 7, text: "this" },
          },
        ],
      }),
      text,
    );

    expect(result.issues).toHaveLength(1);
    expect(text.slice(result.issues[0].startIndex, result.issues[0].endIndex)).toBe("this");
  });

  it("drops issues whose text cannot be located", () => {
    const result = toCheckResult(
      workflow({
        issues: [
          {
            severity: "low",
            category: "Tone",
            position: { start: 0, end: 9, text: "not in the document at all" },
          },
        ],
      }),
      TEXT,
    );

    expect(result.issues).toHaveLength(0);
  });

  it("drops issues without usable positions", () => {
    const result = toCheckResult(
      workflow({ issues: [{ severity: "high", category: "Grammar" }] }),
      TEXT,
    );
    expect(result.issues).toHaveLength(0);
  });

  it("falls back to guideline name and default category/severity", () => {
    const result = toCheckResult(
      workflow({
        issues: [
          {
            position: { start: 5, end: 8, text: "are" },
            guideline_name: "Subject-verb agreement",
          },
        ],
      }),
      TEXT,
    );

    const issue = result.issues[0];
    expect(issue.category).toBe("Style");
    expect(issue.message).toBe("Subject-verb agreement");
    expect(issue.severity).toBe("low");
    expect(issue.suggestion).toBe("");
    expect(issue.id).toBe("issue-0");
  });

  it("extracts a quality score from result.quality when scoring is enabled", () => {
    const result = toCheckResult(workflow({ issues: [], quality: { score: 87 } }), TEXT);
    expect(result.assessment.score).toBe(87);
  });

  it("extracts a quality score from the legacy scores.quality nesting", () => {
    const result = toCheckResult(
      workflow({ issues: [], scores: { quality: { score: 42 } } }),
      TEXT,
    );
    expect(result.assessment.score).toBe(42);
  });

  it("handles null results and missing issues", () => {
    const result = toCheckResult(workflow(null), TEXT);
    expect(result.issues).toHaveLength(0);
    expect(result.assessment.risk.total).toBe(0);
  });
});

describe("summarizeRisk", () => {
  it("counts issues by severity", () => {
    const make = (severity: ContentIssue["severity"]): ContentIssue => ({
      id: "x",
      startIndex: 0,
      endIndex: 1,
      category: "Grammar",
      message: "m",
      suggestion: "",
      originalText: "t",
      severity,
    });

    const risk = summarizeRisk([make("high"), make("high"), make("medium"), make("low")]);
    expect(risk).toEqual({ high: 2, medium: 1, low: 1, total: 4 });
  });
});
