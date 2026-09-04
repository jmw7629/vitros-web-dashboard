const TARGET_SHA = "e25fde7f48a1f29a6a0d90aa71091d76f64cf644";
const base = `https://raw.githubusercontent.com/jmw7629/vitros-web-dashboard/${TARGET_SHA}`;

async function get(path) {
  const res = await fetch(`${base}/${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to fetch ${path} at ${TARGET_SHA}: ${res.status}`);
  return await res.text();
}

const rem = await get("convex/rem.ts");
const bulk = await get("convex/bulkImport.ts");

if (!rem.includes('import { internalMutation, query } from "./_generated/server";')) throw new Error("REM module does not import internalMutation");
if (!rem.includes("export const updateAnalyzer = internalMutation({")) throw new Error("Legacy REM updateAnalyzer is still publicly callable");
if (/export const updateAnalyzer\s*=\s*mutation\s*\(/.test(rem)) throw new Error("Public REM mutation export remains");

if (!bulk.includes('import { internalMutation } from "./_generated/server";')) throw new Error("Bulk import module does not import internalMutation");
const names = ["importParts","importEmployees","importKits","importAnalyzers","importLvcc","importWeeklyNotes","importSettings"];
for (const name of names) {
  if (!bulk.includes(`export const ${name} = internalMutation({`)) throw new Error(`${name} is not internal-only`);
  const publicPattern = new RegExp(`export const ${name}\\s*=\\s*mutation\\s*\\(`);
  if (publicPattern.test(bulk)) throw new Error(`${name} still exposes a public mutation`);
}
if (/\bmutation\s*\(/.test(bulk)) throw new Error("A public mutation call remains in deprecated bulkImport.ts");

console.log(`VERIFY=PASS SHA=${TARGET_SHA} REM_UPDATE=INTERNAL_ONLY BULK_IMPORTS=INTERNAL_ONLY PUBLIC_LEGACY_MUTATIONS=NONE`);
