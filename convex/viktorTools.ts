/**
 * Viktor Tools - gated server-side helpers for approved Viktor SDK functions.
 *
 * These actions use a server-only project secret. They must never be callable
 * anonymously or return upstream error bodies that could disclose provider data.
 */
import { v } from "convex/values";
import { action } from "./_generated/server";
import { requireCapability } from "./authGuard";

declare const process: { env: Record<string, string | undefined> };

const MAX_SEARCH_QUERY_LENGTH = 1000;
const MAX_IMAGE_PROMPT_LENGTH = 4000;

function requireBoundedText(value: string, field: string, maxLength: number): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${field} is required`);
  if (trimmed.length > maxLength) {
    throw new Error(`${field} is too long`);
  }
  return trimmed;
}

function getViktorConfig() {
  const apiUrl = process.env.VIKTOR_SPACES_API_URL?.trim();
  const projectName = process.env.VIKTOR_SPACES_PROJECT_NAME?.trim();
  const projectSecret = process.env.VIKTOR_SPACES_PROJECT_SECRET?.trim();

  if (!apiUrl || !projectName || !projectSecret) {
    throw new Error("Viktor tools are not configured");
  }

  return { apiUrl, projectName, projectSecret };
}

async function callTool<T>(role: string, args: Record<string, unknown> = {}): Promise<T> {
  const { apiUrl, projectName, projectSecret } = getViktorConfig();

  const response = await fetch(`${apiUrl}/api/viktor-spaces/tools/call`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      project_name: projectName,
      project_secret: projectSecret,
      role,
      arguments: args,
    }),
  });

  if (!response.ok) {
    throw new Error("Viktor tool request failed");
  }

  const json = (await response.json()) as { success?: boolean; result?: T };
  if (!json.success || json.result === undefined) {
    throw new Error("Viktor tool request failed");
  }
  return json.result;
}

export const quickAiSearch = action({
  args: { query: v.string() },
  returns: v.string(),
  handler: async (ctx, { query }) => {
    await requireCapability(ctx, "ai.ocr");
    const boundedQuery = requireBoundedText(query, "Search query", MAX_SEARCH_QUERY_LENGTH);
    const result = await callTool<{ search_response: string }>("quick_ai_search", {
      search_question: boundedQuery,
    });
    return result.search_response;
  },
});

export const generateImage = action({
  args: {
    prompt: v.string(),
    aspectRatio: v.optional(
      v.union(
        v.literal("1:1"),
        v.literal("16:9"),
        v.literal("9:16"),
        v.literal("4:3"),
        v.literal("3:2"),
      ),
    ),
  },
  returns: v.string(),
  handler: async (ctx, { prompt, aspectRatio }) => {
    await requireCapability(ctx, "ai.ocr");
    const boundedPrompt = requireBoundedText(prompt, "Image prompt", MAX_IMAGE_PROMPT_LENGTH);
    const result = await callTool<{ response_text: string }>("text2im", {
      prompt: boundedPrompt,
      aspect_ratio: aspectRatio ?? "1:1",
    });
    return result.response_text;
  },
});
