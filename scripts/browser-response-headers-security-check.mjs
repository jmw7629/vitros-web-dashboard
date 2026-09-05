import fs from "node:fs";

// Keep this gate intentionally dependency-free so it can run before install/build work.
const config = JSON.parse(fs.readFileSync("vercel.json", "utf8"));
const globalRule = (config.headers || []).find((rule) => rule.source === "/(.*)");
if (!globalRule || !Array.isArray(globalRule.headers)) {
  throw new Error("Global Vercel response-header rule is missing");
}

const headers = new Map(globalRule.headers.map(({ key, value }) => [String(key).toLowerCase(), String(value)]));
const get = (name) => {
  const value = headers.get(name.toLowerCase());
  if (!value) throw new Error(`Required security header is missing: ${name}`);
  return value;
};

const hsts = get("Strict-Transport-Security");
const maxAge = Number(/(?:^|;)\s*max-age=(\d+)/i.exec(hsts)?.[1] || 0);
if (!Number.isSafeInteger(maxAge) || maxAge < 31536000) {
  throw new Error("HSTS max-age must be at least one year");
}
if (!/(?:^|;)\s*includeSubDomains(?:;|$)/i.test(hsts)) {
  throw new Error("HSTS must cover subdomains");
}

const csp = get("Content-Security-Policy");
for (const directive of [
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
]) {
  if (!csp.split(";").some((entry) => entry.trim() === directive)) {
    throw new Error(`CSP missing invariant: ${directive}`);
  }
}
for (const forbidden of ["'unsafe-eval'", "frame-ancestors *", "object-src *", "base-uri *"]) {
  if (csp.includes(forbidden)) throw new Error(`CSP contains unsafe relaxation: ${forbidden}`);
}

const exact = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-frame-options": "DENY",
  "x-xss-protection": "0",
  "x-dns-prefetch-control": "off",
  "origin-agent-cluster": "?1",
  "permissions-policy": "camera=(self), microphone=(), geolocation=()",
};
for (const [name, expected] of Object.entries(exact)) {
  if (get(name) !== expected) throw new Error(`${name} must remain ${expected}`);
}

const buildCommand = String(config.buildCommand || "");
if (!buildCommand.includes("npx convex deploy") || !buildCommand.includes("VITE_CONVEX_URL")) {
  throw new Error("Browser-header hardening must not bypass the reviewed Convex/Vercel deployment coupling");
}

console.log("BROWSER_RESPONSE_HEADERS_SECURITY=PASS");
