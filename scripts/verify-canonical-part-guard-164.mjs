import { execFileSync } from "node:child_process";

const target = "4ce5eb67271f48ec780e1edd8cabdbdc5c260660";
const base = "fc273738a043333162beab721897fb739c18620f";
const migrationPath = "database/migrations/20260902_stock_canonical_part_number_guard.sql";

function git(...args) { return execFileSync("git", args, { encoding: "utf8" }).trim(); }
function requireTrue(value, message) { if (!value) throw new Error(message); }

const files = git("diff", "--name-only", base, target).split("\n").filter(Boolean);
requireTrue(files.length === 1 && files[0] === migrationPath, `unexpected diff files: ${files.join(", ")}`);
const sql = git("show", `${target}:${migrationPath}`);

requireTrue(/CREATE UNIQUE INDEX IF NOT EXISTS stock_part_number_canonical_unique_except_legacy_j32133/i.test(sql), "canonical unique index missing");
requireTrue(/upper\(btrim\(part_number\)\)/i.test(sql), "canonical UPPER(BTRIM()) identity missing");
requireTrue(/WHERE upper\(btrim\(part_number\)\) <> 'J32133'/i.test(sql), "legacy J32133 quarantine exception missing");
requireTrue(/BEFORE INSERT OR UPDATE OF part_number/i.test(sql), "part-number guard trigger missing");
requireTrue(/ERRCODE = '23505'/i.test(sql) && /Part number already exists/i.test(sql), "deterministic duplicate rejection missing");
requireTrue(/ERRCODE = '23514'/i.test(sql) && /Part number is required/i.test(sql), "blank-part rejection missing");
requireTrue(!/\bDELETE\b|\bTRUNCATE\b|qty_on_hand\s*=|UPDATE\s+public\.stock\s+SET/i.test(sql), "destructive/business quantity mutation present");
requireTrue(!/GRANT\s+.*(?:anon|authenticated)|DISABLE\s+ROW\s+LEVEL\s+SECURITY/i.test(sql), "auth/RLS weakening present");

console.log(`VERIFY=PASS SHA=${target}`);
