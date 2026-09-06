import fs from "node:fs";

const source = fs.readFileSync(new URL("../convex/viktorTools.ts", import.meta.url), "utf8");

function requireMatch(pattern, message) {
  if (!pattern.test(source)) throw new Error(message);
}

function forbid(pattern, message) {
  if (pattern.test(source)) throw new Error(message);
}

requireMatch(
  /export const quickAiSearch = action\([\s\S]*?handler:\s*async \(ctx,[\s\S]*?requireCapability\(ctx,\s*["']ai\.ocr["']\)/m,
  "quickAiSearch must require the existing restricted AI capability",
);

requireMatch(
  /export const generateImage = action\([\s\S]*?handler:\s*async \(ctx,[\s\S]*?requireCapability\(ctx,\s*["']ai\.ocr["']\)/m,
  "generateImage must require the existing restricted AI capability",
);

requireMatch(
  /MAX_SEARCH_QUERY_LENGTH\s*=\s*1000[\s\S]*?requireBoundedText\(query,\s*["']Search query["'],\s*MAX_SEARCH_QUERY_LENGTH\)/m,
  "search requests must be nonblank and bounded",
);

requireMatch(
  /MAX_IMAGE_PROMPT_LENGTH\s*=\s*4000[\s\S]*?requireBoundedText\(prompt,\s*["']Image prompt["'],\s*MAX_IMAGE_PROMPT_LENGTH\)/m,
  "image prompts must be nonblank and bounded",
);

requireMatch(
  /process\.env\.VIKTOR_SPACES_PROJECT_SECRET/,
  "Viktor project credential must remain server-only",
);

forbid(/VITE_/m, "Privileged Viktor configuration must never use a browser VITE variable");
forbid(/handler:\s*async \(_ctx/m, "Secret-backed Viktor actions must not discard auth context");
forbid(/await response\.text\(\)/m, "Upstream HTTP error bodies must not be surfaced");
forbid(/json\.error/m, "Upstream tool error text must not be surfaced");

requireMatch(
  /if \(!response\.ok\)\s*\{\s*throw new Error\(["']Viktor tool request failed["']\)/m,
  "HTTP failures must be sanitized",
);

console.log("VIKTOR_TOOL_RBAC=PASS");
console.log("VIKTOR_TOOL_INPUT_BOUNDS=PASS");
console.log("VIKTOR_TOOL_SECRET_BOUNDARY=SERVER_ONLY");
console.log("VIKTOR_TOOL_UPSTREAM_ERROR_REDACTION=PASS");
