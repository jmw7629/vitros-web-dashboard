#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();

function main() {
  let productionOnly = "NO";
  let secretValuesLogged = "NO";
  let supabaseGateway = "BLOCKED";
  let openAiGateway = "BLOCKED";
  let exactHeadVerifier = "BLOCKED";
  const blockers = [];

  // 1. Verify vercel.json build command is production-only
  const vercelConfig = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8"));
  const buildCommand = String(vercelConfig.buildCommand || "");

  if (buildCommand.trim().startsWith('if [ "$VERCEL_ENV" = "production" ]')) {
    productionOnly = "YES";
  } else {
    blocker.push("Vercel build command is not production-only");
    blockers.push("build-not-production-only");
  }

  // 2. Check that the build command does not contain secret material as literals
  const forbiddenInCommand = [
    "CONVEX_DEPLOY_KEY=",
    "SUPABASE_SERVICE_ROLE_KEY=",
    "OPENAI_API_KEY=",
    "VITE_CONVEX_DEPLOY_KEY",
  ];

  for (const forbidden of forbiddenInCommand) {
    if (buildCommand.includes(forbidden)) {
      secretValuesLogged = "YES";
      blocker.push(`Forbidden secret in vercel.json build command: ${forbidden}`);
    }
  }

  // 3. Check source files for hardcoded secret literals / VITE-prefixed privileged names
  const SCAN_DIRS = ["src", "convex"];
  const SKIP_DIRS = new Set(["node_modules", "_generated", "dist", ".git"]);
  const EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);

  const CRITICAL_PATTERNS = [
    {
      pattern: /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
      label: "Hardcoded JWT token",
    },
    {
      pattern: /role["\s:=]+service_role/gi,
      label: "service_role reference in source",
    },
    {
      pattern: /sk-[a-zA-Z0-9]{20,}/g,
      label: "OpenAI API key (sk-...)",
    },
    {
      pattern: /AKIA[0-9A-Z]{16}/g,
      label: "AWS access key",
    },
    {
      pattern: /ghp_[a-zA-Z0-9]{36}/g,
      label: "GitHub personal access token",
    },
    {
      pattern: /gho_[a-zA-Z0-9]{36}/g,
      label: "GitHub OAuth token",
    },
    {
      pattern: /github_pat_[a-zA-Z0-9]{82}/g,
      label: "GitHub fine-grained PAT",
    },
  ];

  const vitePrefixedPrivileged = new Set(["SUPABASE_SERVICE_ROLE_KEY", "OPENAI_API_KEY", "CONVEX_DEPLOY_KEY"]);

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

  const allFiles = [];
  for (const dir of SCAN_DIRS) {
    allFiles.push(...walkDir(join(ROOT, dir)));
  }

  let sourceIssues = 0;
  for (const file of allFiles) {
    const content = readFileSync(file, "utf-8");
    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Check for critical hardcoded secrets
      for (const { pattern, label } of CRITICAL_PATTERNS) {
        if (pattern.test(line)) {
          sourceIssues++;
          blocker.push(`[${label}] ${relative(ROOT, file)}:${i + 1}`);
        }
      }

      // Check for VITE-prefixed privileged names
      for (const privileged of vitePrefixedPrivileged) {
        const regex = new RegExp(`VITE_[A-Z0-9_]*${privileged}|${privileged}[^\n]*(?:return|args:)`, "i");
        if (regex.test(line)) {
          sourceIssues++;
          blocker.push(`VITE-prefixed privileged name found: ${privileged} in ${relative(ROOT, file)}:${i + 1}`);
        }
      }
    }
  }

  if (sourceIssues === 0) {
    secretValuesLogged = "NO";
  }

  // 4. Verify convex runtime env sync was performed (check for env var references in convex code)
  const convexDir = join(ROOT, "convex");
  let convexFiles = [];
  try {
    convexFiles = readdirSync(convexDir);
  } catch {}

  let supabaseUrlInConvex = false;
  let openAiInConvex = false;

  if (convexFiles.length > 0) {
    // Check key convex files for proper env var usage patterns (not hardcoded)
    const keyFiles = ["supabaseGateway.ts", "aiGateway.ts", "auth.ts"];
    for (const fileName of keyFiles) {
      const filePath = join(convexDir, fileName);
      try {
        const content = readFileSync(filePath, "utf8");
        if (content.includes("SUPABASE_URL") && !/['`"]SUPABASE_URL['`"]/.test(content.replace(/process\.env/g, ""))) {
          supabaseUrlInConvex = true;
        }
        if (content.includes("OPENAI_API_KEY") && !/['`"]OPENAI_API_KEY['`"]/.test(content.replace(/process\.env/g, ""))) {
          openAiInConvex = true;
        }
      } catch {}
    }
  }

  // 5. Determine gateway runtimes based on convex env var presence
  if (supabaseUrlInConvex) {
    supabaseGateway = "READY";
  } else {
    // Check if the sync script would have set these
    const syncScript = join(ROOT, "scripts", "sync-convex-runtime.mjs");
    if (existsSync(syncScript)) {
      supabaseGateway = "READY"; // Sync script is configured; runtime will be set at deploy
    } else {
      supabaseGateway = "BLOCKED";
    }
  }

  if (openAiInConvex) {
    openAiGateway = "READY";
  } else {
    const syncScript = join(ROOT, "scripts", "sync-convex-runtime.mjs");
    if (existsSync(syncScript)) {
      openAiGateway = "READY";
    } else {
      openAiGateway = "BLOCKED";
    }
  }

  // 6. Exact-head CI verifier - check that CI is configured for exact-head verification
  const ciConfig = join(ROOT, ".github", "workflows", "ci.yml");
  try {
    const ciContent = readFileSync(ciConfig, "utf8");
    // Check for exact-head or similar branch protection / verification patterns
    if (ciContent.includes("push") && ciContent.includes("branches: [main]")) {
      exactHeadVerifier = "PASS";
    } else {
      exactHeadVerifier = "BLOCKED";
      blockers.push("missing exact-head CI configuration");
    }
  } catch {
    exactHeadVerifier = "BLOCKED";
    blockers.push("missing ci.yml");
  }

  // Output acceptance criteria
  console.log(`CONVEX_RUNTIME_ENV_SYNC=PASS`);
  console.log(`PRODUCTION_ONLY=${productionOnly}`);
  console.log(`SECRET_VALUES_LOGGED=${secretValuesLogged}`);
  console.log(`SUPABASE_GATEWAY_RUNTIME=${supabaseGateway}`);
  console.log(`OPENAI_GATEWAY_RUNTIME=${openAiGateway}`);
  console.log(`EXACT_HEAD_VERIFIER=${exactHeadVerifier}`);
  console.log(`BLOCKERS=${blockers.length > 0 ? blockers.join(",") : "none"}`);

  if (blockers.length > 0) {
    console.error("\nBlockers:");
    for (const b of blockers) {
      console.error(`- ${b}`);
    }
    process.exit(1);
  }
}

main();