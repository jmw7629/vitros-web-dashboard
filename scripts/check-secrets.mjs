#!/usr/bin/env node
/**
 * Secret pattern regression check.
 * Scans src/ and convex/ for hardcoded credentials that must never be committed.
 * Exits with code 1 if any secrets are found.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SCAN_DIRS = ["src", "convex"];
const SKIP_DIRS = new Set(["node_modules", "_generated", "dist", ".git"]);
const EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);

const CRITICAL_PATTERNS = [
  {
    pattern: /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
    label: "Hardcoded JWT token",
    severity: "CRITICAL",
  },
  {
    pattern: /role["\s:=]+service_role/gi,
    label: "service_role reference in source",
    severity: "CRITICAL",
  },
  {
    pattern: /sk-[a-zA-Z0-9]{20,}/g,
    label: "OpenAI API key (sk-...)",
    severity: "CRITICAL",
  },
  {
    pattern: /AKIA[0-9A-Z]{16}/g,
    label: "AWS access key",
    severity: "CRITICAL",
  },
  {
    pattern: /ghp_[a-zA-Z0-9]{36}/g,
    label: "GitHub personal access token",
    severity: "CRITICAL",
  },
  {
    pattern: /gho_[a-zA-Z0-9]{36}/g,
    label: "GitHub OAuth token",
    severity: "CRITICAL",
  },
  {
    pattern: /github_pat_[a-zA-Z0-9]{82}/g,
    label: "GitHub fine-grained PAT",
    severity: "CRITICAL",
  },
];

function isComment(line) {
  const trimmed = line.trim();
  return (
    trimmed.startsWith("//") ||
    trimmed.startsWith("*") ||
    trimmed.startsWith("/*") ||
    trimmed.startsWith("#")
  );
}

function isImport(line) {
  const trimmed = line.trim();
  return trimmed.startsWith("import ") || trimmed.startsWith("from ");
}

function scanFile(filePath) {
  const issues = [];
  const content = readFileSync(filePath, "utf-8");
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    if (isComment(line) || isImport(line)) continue;

    for (const { pattern, label, severity } of CRITICAL_PATTERNS) {
      const re = new RegExp(pattern.source, pattern.flags);
      if (re.test(line)) {
        issues.push({
          file: relative(ROOT, filePath),
          line: lineNum,
          message: label,
          severity,
        });
      }
    }
  }

  return issues;
}

function walkDir(dir) {
  const files = [];
  try {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue;
      const fullPath = join(dir, entry);
      try {
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          files.push(...walkDir(fullPath));
        } else if (stat.isFile() && EXTENSIONS.has(entry.slice(entry.lastIndexOf(".")))) {
          files.push(fullPath);
        }
      } catch {}
    }
  } catch {}
  return files;
}

function main() {
  const allFiles = [];
  for (const dir of SCAN_DIRS) {
    allFiles.push(...walkDir(join(ROOT, dir)));
  }

  let totalIssues = 0;
  const criticalIssues = [];

  for (const file of allFiles) {
    const issues = scanFile(file);
    for (const issue of issues) {
      totalIssues++;
      const marker = issue.severity === "CRITICAL" ? "CRITICAL" : "HIGH";
      const msg = "[" + marker + "] " + issue.file + ":" + issue.line + " \u2014 " + issue.message;
      console.error(msg);
      if (issue.severity === "CRITICAL") {
        criticalIssues.push(msg);
      }
    }
  }

  if (totalIssues > 0) {
    console.error("\n\u274C Secret scan failed: " + totalIssues + " issue(s) found (" + criticalIssues.length + " critical)");
    process.exit(1);
  }

  console.log("\u2705 Secret scan passed: no hardcoded credentials found");
}

main();
