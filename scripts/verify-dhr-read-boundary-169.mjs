import { execFileSync } from "node:child_process";

const target = "f73f84db8316fd11c72b7faa01ff16e3ef09f245";
const base = "d5b0c77a57a928fe8de43fdba033e7ab8aab8b78";
function git(...args) { return execFileSync("git", args, { encoding: "utf8" }).trim(); }
function requireTrue(value, message) { if (!value) throw new Error(message); }

const files = git("diff", "--name-only", base, target).split("\n").filter(Boolean).sort();
requireTrue(JSON.stringify(files) === JSON.stringify(["convex/dhrInventoryActions.ts", "src/hooks/useServerActions.ts"]), `unexpected diff files: ${files.join(", ")}`);

const action = git("show", `${target}:convex/dhrInventoryActions.ts`);
requireTrue(/export const loadScannerData = action/.test(action), "scanner bootstrap action missing");
requireTrue(/export const loadSessionResults = action/.test(action), "session results action missing");
requireTrue((action.match(/requireCapability\(ctx, "inventory\.read"\)/g) || []).length >= 2, "inventory.read capability missing from DHR reads");
requireTrue(!/select=\*/.test(action), "unbounded select=* found in DHR server reads");
requireTrue(/dhr_checklist_sections\?select=id,analyzer_model,section_id,section_name,section_type,has_parts,page_number,notes/.test(action), "sections projection not allowlisted");
requireTrue(/dhr_expected_parts\?select=id,analyzer_model,section_id,part_number,description,bom_qty,category,notes,sort_order/.test(action), "expected-parts projection not allowlisted");
requireTrue(/dhr_scan_sessions\?select=id,instrument_sn,wo_number,analyzer_model,started_at,completed_at,status,started_by,notes/.test(action), "sessions projection not allowlisted");
requireTrue(/convex_employees\?select=id,name,initials,active&active=eq\.true/.test(action), "active employee display projection missing");
requireTrue(/dhr_scan_results\?select=.*revision/.test(action), "authoritative DHR revision missing from result projection");
requireTrue(/Invalid DHR session id/.test(action) && /encodeURIComponent\(sessionId\)/.test(action), "session id validation/encoding missing");
requireTrue(/SUPABASE_SERVICE_ROLE_KEY/.test(action), "server service-role boundary missing");
requireTrue(!/VITE_SUPABASE_SERVICE_ROLE_KEY|VITE_.*(?:SECRET|TOKEN)/.test(action), "client credential pattern introduced in server action");

const hook = git("show", `${target}:src/hooks/useServerActions.ts`);
requireTrue(/loadDhrScannerDataAction = useAction\(api\.dhrInventoryActions\.loadScannerData\)/.test(hook), "scanner bootstrap hook binding missing");
requireTrue(/loadDhrSessionResultsAction = useAction\(api\.dhrInventoryActions\.loadSessionResults\)/.test(hook), "session results hook binding missing");
requireTrue(/loadDhrScannerData/.test(hook) && /loadDhrSessionResults/.test(hook), "DHR read callbacks not returned");
requireTrue(/Direct stock quantity updates are not permitted/.test(hook), "direct stock write block removed");
requireTrue(!/SUPABASE_SERVICE_ROLE_KEY|serviceKey/.test(hook), "service-role material leaked to browser hook");

const diff = git("diff", base, target);
requireTrue(!/database\/migrations|create policy|alter table.*row level security|grant .* to anon/i.test(diff), "RLS/grant change introduced");
requireTrue(!/src\/pages\/inventory\/DhrScanner\.tsx/.test(files.join("\n")), "scanner UI changed in read-boundary PR");
requireTrue(!/apply_inventory_transition|insert into sap_staging/i.test(diff), "business mutation added to read boundary");

console.log(`VERIFY=PASS SHA=${target}`);
