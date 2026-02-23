import { MarkupAIClient, MarkupAI } from "@markupai/api";
import { ContentIssue, CheckResult, StyleGuideOption } from "./types";
import { TextOffsetMapper } from "./offsetMapper";
import { BUILT_IN_STYLE_GUIDES, POLL_INTERVAL_MS, MAX_POLL_ATTEMPTS } from "./constants";

/**
 * MarkupAI API Client wrapper
 * Handles communication with the MarkupAI service for content checking
 */
export class MarkupAIContentChecker {
  private readonly client: MarkupAIClient;
  private offsetMapper: TextOffsetMapper | null = null;

  constructor(apiToken: string) {
    this.client = new MarkupAIClient({
      token: apiToken,
    });
  }

  async fetchStyleGuides(): Promise<StyleGuideOption[]> {
    try {
      const styleGuides = await this.client.styleGuides.listStyleGuides();

      // Known built-in style guide names (case-insensitive matching)
      const builtInNames = new Set([
        "ap style guide",
        "ap",
        "associated press",
        "chicago manual of style",
        "chicago",
        "cmos",
        "microsoft style guide",
        "microsoft",
        "microsoft writing style guide",
      ]);

      const customGuides: StyleGuideOption[] = [];
      const builtInGuides: StyleGuideOption[] = [];

      for (const guide of styleGuides) {
        const nameLower = guide.name.toLowerCase();
        const idLower = guide.id.toLowerCase();

        // Check if this is a built-in style guide by name or ID
        const isBuiltIn =
          builtInNames.has(nameLower) ||
          builtInNames.has(idLower) ||
          nameLower.includes("ap style") ||
          nameLower.includes("chicago") ||
          nameLower.includes("microsoft");

        const styleGuideOption: StyleGuideOption = {
          id: guide.id,
          name: guide.name,
          isBuiltIn: isBuiltIn,
        };

        if (isBuiltIn) {
          builtInGuides.push(styleGuideOption);
        } else {
          customGuides.push(styleGuideOption);
        }
      }

      // Custom/server guides at top, built-in guides at bottom
      return [...customGuides, ...builtInGuides];
    } catch (error) {
      console.error("MarkupAI: Error fetching style guides", error);
      return BUILT_IN_STYLE_GUIDES;
    }
  }

  async checkContent(
    text: string,
    dialect: MarkupAI.Dialects,
    styleGuide: string,
    filename?: string,
  ): Promise<CheckResult> {
    // Create offset mapper for Unicode handling
    this.offsetMapper = new TextOffsetMapper(text);

    // Determine file extension and MIME type
    const fileExtension = filename ? filename.split(".").pop()?.toLowerCase() : "txt";
    const mimeType = this.getMimeType(fileExtension || "txt");
    const fileName = filename || `content.${fileExtension || "txt"}`;

    // Create a Blob from the text content
    const blob = new Blob([text], { type: mimeType });
    const file = new File([blob], fileName, { type: mimeType });

    // Create style suggestion request
    const workflowResponse = await this.client.styleSuggestions.createStyleSuggestion({
      file_upload: file,
      dialect: dialect,
      style_guide: styleGuide,
    });

    const workflowId = workflowResponse.workflow_id;

    // Poll for results
    const result = await this.pollForResults(workflowId);
    return result;
  }

  private async pollForResults(workflowId: string): Promise<CheckResult> {
    let attempts = 0;

    while (attempts < MAX_POLL_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      attempts++;

      try {
        const suggestionResponse =
          await this.client.styleSuggestions.getStyleSuggestion(workflowId);
        const status = suggestionResponse.workflow.status;

        if (status === "completed") {
          return this.parseResponse(suggestionResponse);
        } else if (status === "failed") {
          throw new Error("MarkupAI: Content check failed");
        }
        // If still running, continue polling
      } catch (error: unknown) {
        if (
          typeof error === "object" &&
          error !== null &&
          "statusCode" in error &&
          error.statusCode === 404
        ) {
          // Workflow not found yet, continue polling
          continue;
        }
        throw error;
      }
    }

    throw new Error("MarkupAI: Content check timed out");
  }

  private parseResponse(response: MarkupAI.SuggestionResponse): CheckResult {
    const issues: ContentIssue[] = [];
    const apiIssues = response.original?.issues || [];

    for (let i = 0; i < apiIssues.length; i++) {
      const issue = apiIssues[i];
      const issueType = this.mapCategoryToType(issue.category);

      // Convert API offset to JavaScript string index
      // The API likely returns Unicode code point offsets, which differ from
      // JavaScript's UTF-16 code unit indices for emojis and other non-BMP characters
      let startIndex: number;
      let endIndex: number;

      if (this.offsetMapper) {
        // First, try to convert the code point offset
        const convertedStart = this.offsetMapper.codePointOffsetToStringIndex(
          issue.position.start_index,
        );

        // Then, verify by finding the actual text in the document
        // This handles any remaining edge cases and ensures accuracy
        const position = this.offsetMapper.findNearbyText(
          issue.original,
          convertedStart,
          50, // Search within 50 characters if not exact match
        );

        if (position) {
          startIndex = position.start;
          endIndex = position.end;
        } else {
          // Fallback: use the converted offset and calculate end from original length
          startIndex = convertedStart;
          endIndex = startIndex + issue.original.length;
        }
      } else {
        // No mapper available, use raw values (fallback)
        startIndex = issue.position.start_index;
        endIndex = issue.position.start_index + issue.original.length;
      }

      issues.push({
        id: `issue-${String(i)}`,
        startIndex: startIndex,
        endIndex: endIndex,
        type: issueType,
        category: issue.category,
        subcategory: typeof issue.subcategory === "string" ? issue.subcategory : undefined,
        message:
          issue.explanation ||
          `${issue.category ?? "Issue"}: Replace "${issue.original}" with "${issue.suggestion}"`,
        suggestion: issue.suggestion,
        originalText: issue.original,
        severity: issue.severity,
      });
    }

    const qualityScore = response.original?.scores?.quality;
    const scores = {
      overall: qualityScore?.score ?? 100,
      grammar: qualityScore?.grammar?.score ?? 100,
      consistency: qualityScore?.consistency?.score ?? 100,
      terminology: qualityScore?.terminology?.score ?? 100,
    };

    return { issues, scores };
  }

  private mapCategoryToType(category?: MarkupAI.IssueCategory): ContentIssue["type"] {
    switch (category) {
      case "grammar":
        return "grammar";
      case "clarity":
        return "clarity";
      case "consistency":
        return "consistency";
      case "terminology":
        return "terminology";
      case "tone":
        return "tone";
      default:
        return "grammar";
    }
  }

  private getMimeType(extension: string): string {
    const mimeTypes: { [key: string]: string } = {
      txt: "text/plain",
      md: "text/markdown",
      markdown: "text/markdown",
      html: "text/html",
      htm: "text/html",
      xml: "text/xml",
      dita: "application/xml",
      json: "application/json",
    };
    return mimeTypes[extension] || "text/plain";
  }
}
