import { execFileSync } from "node:child_process";

const target = "3d7f1efb23b7cbb19d5201513fe39c6cb495d923";
const base = "fc273738a043333162beab721897fb739c18620f";
function git(...args) { return execFileSync("git", args, { encoding: "utf8" }).trim(); }
function requireTrue(value, message) { if (!value) throw new Error(message); }

const files = git("diff", "--name-only", base, target).split("\n").filter(Boolean).sort();
requireTrue(JSON.stringify(files) === JSON.stringify(["convex/aiGateway.ts", "src/hooks/useServerActions.ts"]), `unexpected diff files: ${files.join(", ")}`);

const ai = git("show", `${target}:convex/aiGateway.ts`);
requireTrue(/ocrDhrPage = action/.test(ai), "DHR OCR action missing");
requireTrue(/imageUrl: v\.optional\(v\.string\(\)\)/.test(ai) && /imageBase64: v\.optional\(v\.string\(\)\)/.test(ai), "private/base64 DHR source contract missing");
requireTrue(/!!imageUrl === !!imageBase64/.test(ai), "exact-one-image-source validation missing");
requireTrue(/MAX_IMAGE_SIZE_BYTES/.test(ai) && /imageBase64\.length/.test(ai), "base64 size bound missing");
requireTrue(/requireCapability\(ctx, "ai\.ocr"\)/.test(ai), "server OCR capability gate missing");
requireTrue(/process\.env\.OPENAI_API_KEY/.test(ai), "server OpenAI credential boundary missing");

const hook = git("show", `${target}:src/hooks/useServerActions.ts`);
requireTrue(/DhrChecklistChangeArgs/.test(hook), "typed checklist adapter missing");
requireTrue(/partNumber\.trim\(\)\.toUpperCase\(\)/.test(hook), "canonical DHR part normalization missing");
requireTrue(/`r\$\{args\.expectedRevision\}`/.test(hook) && /`q\$\{args\.newQty\}`/.test(hook), "revision+qty correlation identity missing");
requireTrue(/Number\.isInteger\(args\.newQty\)/.test(hook) && /Number\.isInteger\(args\.expectedRevision\)/.test(hook), "integer validation missing");
requireTrue(/applyDhrScanTransition\(\{/.test(hook), "checklist adapter does not route to atomic transition");
requireTrue(/imageUrl\?: string/.test(hook) && /imageBase64\?: string/.test(hook), "hook private OCR source contract missing");
requireTrue(/Direct stock quantity updates are not permitted/.test(hook), "direct stock write block removed");

const diff = git("diff", base, target);
requireTrue(!/VITE_OPENAI_KEY|VITE_.*(?:SECRET|TOKEN)|SUPABASE_SERVICE_ROLE_KEY/.test(diff), "client secret pattern introduced");
requireTrue(!/src\/pages\/inventory\/DhrScanner\.tsx/.test(files.join("\n")), "scanner UI changed in support PR");
requireTrue(!/\bsbInsert\(\"audit_log\"|\bsbInsert\(\"sap_staging\"|\bsbUpdate\(\"stock\"/.test(diff), "direct scanner business writes introduced");

console.log(`VERIFY=PASS SHA=${target}`);
