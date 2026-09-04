import { execFileSync } from "node:child_process";

const target = "c69c6c278c97ad46746420ce089e62f0597f9622";
const base = "8cfa7bf3893a97c88a9ebdf054f2913394e3d5d3";

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const show = (sha, path) => git("show", `${sha}:${path}`);
const requireTrue = (condition, message) => {
  if (!condition) throw new Error(message);
};
const requireTokens = (source, label, tokens) => {
  for (const token of tokens) requireTrue(source.includes(token), `${label} missing: ${token}`);
};
const forbidTokens = (source, label, tokens) => {
  for (const token of tokens) requireTrue(!source.includes(token), `${label} contains forbidden token: ${token}`);
};

requireTrue(git("rev-parse", target) === target, "target SHA is not available exactly");
const changed = git("diff", "--name-only", base, target).split("\n").filter(Boolean).sort();
const expected = ["src/App.tsx", "src/pages/inventory/IncomingStockSecure.tsx"].sort();
requireTrue(JSON.stringify(changed) === JSON.stringify(expected), `unexpected changed files: ${changed.join(", ")}`);

const app = show(target, "src/App.tsx");
const ui = show(target, "src/pages/inventory/IncomingStockSecure.tsx");
const server = show(target, "convex/incomingStockActions.ts");
const ai = show(target, "convex/aiGateway.ts");

requireTokens(app, "route", [
  'import { IncomingStockSecure } from "./pages/inventory/IncomingStockSecure"',
  '<Route path="/incoming-stock" element={<IncomingStockSecure />} />',
]);
forbidTokens(app, "route", ['<Route path="/incoming-stock" element={<IncomingStock />} />']);

requireTokens(ui, "Incoming Stock UI", [
  "api.aiGateway.ocrPackingList",
  "api.incomingStockActions.reviewPackingListDraft",
  "api.incomingStockActions.commitConfirmedReceiveLine",
  'capture="environment"',
  "Confirm & Receive",
  "human-confirmed atomic RECEIVE",
  "confirmationId: existing?.confirmationId ?? makeId(\"confirm\")",
  'line.matchStatus === "matched"',
  "await data.refresh()",
  "Ordered {line.orderedQty}, shipped {line.qty}. RECEIVE uses shipped quantity.",
]);
forbidTokens(ui, "Incoming Stock UI", [
  "VITE_SUPABASE",
  "SUPABASE_ANON_KEY",
  "service_role",
  'scanPart("RECEIVE"',
  "levenshtein",
  "matchPartNumber(",
  "localStorage",
  "api.openai.com",
]);

requireTokens(server, "Incoming Stock server boundary", [
  'requireCapability(ctx, "inventory.write")',
  "canonicalPartNumber(value: string)",
  "value.trim().toUpperCase()",
  'matchStatus = matches.length === 1 ? "matched" : matches.length === 0 ? "unknown_part" : "ambiguous_part"',
  'p_mode: "RECEIVE"',
  'const correlationId = `incoming:${args.confirmationId.trim()}`',
  "matchingCanonicalRows(stockRows, canonical)",
  'if (matches.length > 1) throw new Error("Confirmed part number is ambiguous and cannot be received")',
  "humanConfirmed: true",
]);
forbidTokens(server, "Incoming Stock server boundary", [
  "args.actor",
  "args.user",
  "args.role",
  "fuzzy",
  "levenshtein",
]);

requireTokens(ai, "Incoming OCR gateway", [
  'requireCapability(ctx, "ai.ocr")',
  "VITROS Incoming Stock receiving",
  "Receiving quantity is SHIP QTY / SHIPPED QTY",
  "Description is informational",
]);
forbidTokens(ai, "Incoming OCR gateway", ["VITE_OPENAI_KEY"]);

console.log(`VERIFY=PASS SHA=${target}`);
