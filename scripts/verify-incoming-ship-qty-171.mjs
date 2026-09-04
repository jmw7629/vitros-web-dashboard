import { execFileSync } from "node:child_process";

const target = "a1cfba6cf06b561203a2b760b13c87abef84f12a";
const base = "d5b0c77a57a928fe8de43fdba033e7ab8aab8b78";
function git(...args) { return execFileSync("git", args, { encoding: "utf8" }).trim(); }
function requireTrue(value, message) { if (!value) throw new Error(message); }

const files = git("diff", "--name-only", base, target).split("\n").filter(Boolean).sort();
requireTrue(JSON.stringify(files) === JSON.stringify(["convex/aiGateway.ts"]), `unexpected diff files: ${files.join(", ")}`);

const ai = git("show", `${target}:convex/aiGateway.ts`);
requireTrue(/export const ocrPackingList = action/.test(ai), "packing-list OCR action missing");
requireTrue(/requireCapability\(ctx, "ai\.ocr"\)/.test(ai), "server OCR capability gate missing");
requireTrue(/process\.env\.OPENAI_API_KEY/.test(ai), "server OpenAI credential boundary missing");
requireTrue(/orderedQuantity/.test(ai) && /shippedQuantity/.test(ai), "ordered/shipped quantity fields missing");
requireTrue(/SHIP QTY|SHIPPED QTY/.test(ai), "Ship Qty instruction missing");
requireTrue(/Do not substitute Ordered Qty for Ship Qty/.test(ai), "ordered-vs-ship receiving rule missing");
requireTrue(/Preserve each physical source line separately/.test(ai) && /Do not collapse repeated part lines/.test(ai), "repeated-line review preservation missing");
requireTrue(/rotated about 90 degrees/.test(ai) && /skewed/.test(ai), "rotation/skew instruction missing");
requireTrue(/blank GTIN/.test(ai) && /tracking numbers/.test(ai) && /container counts/.test(ai), "header/GTIN/tracking exclusions missing");
requireTrue(/decimal weights/.test(ai) && /Page 3 of 8/.test(ai), "weight/page-number false-quantity exclusions missing");
requireTrue(/Description is informational/.test(ai), "description identity exclusion missing");
requireTrue(/Return ONLY a JSON array/.test(ai), "strict JSON array contract missing");
requireTrue(/MAX_IMAGE_SIZE_BYTES/.test(ai) && /MAX_PROMPT_LENGTH/.test(ai), "existing OCR bounds removed");
requireTrue(!/VITE_OPENAI_KEY|VITE_.*(?:SECRET|TOKEN)/.test(ai), "browser secret pattern introduced");

const review = git("show", `${base}:convex/incomingStockActions.ts`);
requireTrue(/obj\.shippedQuantity \?\? obj\.shipped_quantity \?\? obj\.shipQty \?\? obj\.ship_qty \?\? obj\.qty \?\? obj\.quantity/.test(review), "review boundary does not prefer shipped quantity output");
requireTrue(/descriptionUsedForIdentity: false/.test(review), "review boundary description identity rule changed/missing");

const diff = git("diff", base, target);
requireTrue(!/apply_inventory_transition|sap_staging|dhr_scan/i.test(diff), "unrelated business mutation introduced");
requireTrue(!/database\/migrations|create policy|grant .* to anon/i.test(diff), "database/RLS change introduced");

console.log(`VERIFY=PASS SHA=${target}`);
