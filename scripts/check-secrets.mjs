#!/usr/bin/env node

/**
 * Secret Pattern Regression Test
 * 
 * Scans frontend source files for hardcoded privileged credentials.
 * Fails if any of these patterns are found:
 * - Supabase service_role JWT (eyJ... with "service_role" in payload)
 * - Hardcoded Supabase service_role key string
 * - Private OpenAI API key (sk-...)
 * - Other common secret patterns in client code
 * 
 * Usage: node scripts/check-secrets.mjs
 */

import { readFileSync, readdirSync, statSync } from "fs";
import { join, extname } from "path";

const SRC_DIR = join(import.meta.dirname, "..", "src");
const CONVEX_DIR = join(import.meta.dirname, "..", "convex");

const PATTERNS = [
  {
    name: "Supabase service_role key (hardcoded JWT)",
    regex: /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
    filter: (match) => {
      // Decode the JWT payload to check for service_role
      try {
        const parts = match.split(".");
        if (parts.length !== 3) return false;
        const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
        return payload.role === "service_role";
      } catch {
        return false;
      }
    },
    severity: "CRITICAL",
  },
  {
    name: "Hardcoded service_role string",
    regex: /["']service_role["']|service_role_key|SERVICE_KEY\s*=\s*["']eyJ/g,
    severity: "CRITICAL",
  },
  {
    name: "OpenAI private API key",
    regex: /sk-[a-zA-Z0-9]{20,}/g,
    severity: "CRITICAL",
  },
  {
    name: "Hardcoded Supabase URL with service key",
    regex: /supabase\.co.*?service_role|SERVICE_KEY.*?supabase/g,
    severity: "HIGH",
  },
  {
    name: "AWS secret access key",
    regex: /(?:aws_secret_access_key|secret_key)\s*[=:]\s*["'][A-Za-z0-9/+=]{40}/g,
    severity: "CRITICAL",
  },
  {
    name: "GitHub personal access token",
    regex: /ghp_[a-zA-Z0-9]{36}|github_pat_[a-zA-Z0-9_]{82}/g,
    severity: "CRITICAL",
  },
];

function getFiles(dir, extensions = [".ts", ".tsx", ".js", ".jsx"]) {
  const files = [];
  try {
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry);
      try {
        const stat = statSync(fullPath);
        if (stat.isDirectory() && entry !== "node_modules" && entry !== "_generated" && entry !== "dist") {
          files.push(...getFiles(fullPath, extensions));
        } else if (stat.isFile() && extensions.includes(extname(entry))) {
          files.push(fullPath);
        }
      } catch {}
    }
  } catch {}
  return files;
}

let hasErrors = false;
const errors = [];

// Scan src/ directory (browser code — no secrets allowed)
const srcFiles = getFiles(SRC_DIR);
console.log(`\n🔍 Scanning ${srcFiles.length} files in src/ for secrets...\n`);

for (const file of srcFiles) {
  const content = readFileSync(file, "utf-8");
  const relativePath = file.replace(SRC_DIR + "/", "");

  for (const pattern of PATTERNS) {
    const matches = content.matchAll(new RegExp(pattern.regex.source, pattern.regex.flags));
    for (const match of matches) {
      if (pattern.filter && !pattern.filter(match[0])) continue;

      const lineNum = content.substring(0, match.index).split("\n").length;
      const line = content.split("\n")[lineNum - 1]?.trim() || "";

      // Skip comments and type declarations
      if (line.startsWith("//") || line.startsWith("*") || line.startsWith("import ")) continue;

      errors.push({
        file: relativePath,
        line: lineNum,
        pattern: pattern.name,
        severity: pattern.severity,
        context: line.substring(0, 100),
      });
      hasErrors = true;
    }
  }
}

// Also scan convex/ for hardcoded secrets in non-server-only files
const convexFiles = getFiles(CONVEX_DIR);
console.log(`🔍 Scanning ${convexFiles.length} files in convex/ for secrets...\n`);

for (const file of convexFiles) {
  const content = readFileSync(file, "utf-8");
  const relativePath = file.replace(CONVEX_DIR + "/", "");

  // Skip generated files
  if (relativePath.startsWith("_generated/")) continue;

  for (const pattern of PATTERNS) {
    const matches = content.matchAll(new RegExp(pattern.regex.source, pattern.regex.flags));
    for (const match of matches) {
      if (pattern.filter && !pattern.filter(match[0])) continue;

      const lineNum = content.substring(0, match.index).split("\n").length;
      const line = content.split("\n")[lineNum - 1]?.trim() || "";

      // Skip comments
      if (line.startsWith("//") || line.startsWith("*")) continue;

      // In convex/ files, hardcoded keys are less severe but still flagged
      errors.push({
        file: `convex/${relativePath}`,
        line: lineNum,
        pattern: pattern.name,
        severity: pattern.severity === "CRITICAL" ? "HIGH" : pattern.severity,
        context: line.substring(0, 100),
      });
      hasErrors = true;
    }
  }
}

// Report
if (errors.length === 0) {
  console.log("✅ No secrets found in source files.\n");
  process.exit(0);
} else {
  console.log(`\n❌ Found ${errors.length} potential secret(s):\n`);
  for (const err of errors) {
    console.log(`  [${err.severity}] ${err.file}:${err.line}`);
    console.log(`    Pattern: ${err.pattern}`);
    console.log(`    Line: ${err.context}`);
    console.log();
  }
  process.exit(1);
}
