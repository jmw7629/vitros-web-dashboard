import fs from "node:fs";

const source = fs.readFileSync(new URL("../convex/cycleCount.ts", import.meta.url), "utf8");

function requireMatch(pattern, message) {
  if (!pattern.test(source)) throw new Error(message);
}

function forbid(pattern, message) {
  if (pattern.test(source)) throw new Error(message);
}

requireMatch(/import\s+\{\s*requireCapability\s*\}\s+from\s+["']\.\/authGuard["']/, "Cycle Count must use the shared server capability guard");

for (const queryName of ["listSchedules", "listResults", "getSchedule", "getResultsBySchedule"]) {
  requireMatch(
    new RegExp(`export const ${queryName} = query\\([\\s\\S]*?requireCapability\\(ctx, ["']inventory\\.read["']\\)`, "m"),
    `${queryName} must require inventory.read`,
  );
}

for (const mutationName of ["createSchedule", "updateSchedule", "submitCount", "createResult"]) {
  requireMatch(
    new RegExp(`export const ${mutationName} = mutation\\([\\s\\S]*?requireCapability\\(ctx, ["']inventory\\.write["']\\)`, "m"),
    `${mutationName} must require inventory.write`,
  );
}

for (const destructiveName of ["deleteSchedule", "deleteResult"]) {
  requireMatch(
    new RegExp(`export const ${destructiveName} = mutation\\([\\s\\S]*?requireCapability\\(ctx, ["']inventory\\.admin["']\\)`, "m"),
    `${destructiveName} must require inventory.admin`,
  );
}

requireMatch(/countedBy:\s*actorName/, "Persisted cycle-count actor must be server-derived");
forbid(/countedBy:\s*args\.countedBy/, "Caller-provided countedBy must not be persisted as authority");
requireMatch(/variance:\s*countedQty\s*-\s*systemQty/, "Variance must be recomputed at the server boundary");
requireMatch(/if\s*\(!schedule\)\s*throw new Error\(["']Cycle count schedule not found["']\)/, "Result submission must reject an unknown schedule");
forbid(/Failed to update schedule nextDue/, "Schedule lifecycle failures must not be swallowed after result insert");
requireMatch(/Number\.isSafeInteger\(value\)\s*\|\|\s*value\s*<\s*0/, "Count quantities must be validated as non-negative safe integers");
requireMatch(/MAX_RESULTS_PER_SUBMISSION/, "Cycle-count result payload must be bounded");
requireMatch(/MAX_PARTS_PER_SCHEDULE/, "Cycle-count schedule payload must be bounded");
forbid(/ctx\.db\.patch\([^\n]*stock/i, "Cycle Count must not directly mutate stock");
forbid(/ctx\.db\.insert\(["']transactions["']/, "Cycle Count containment must not create a parallel inventory ledger");

console.log("CYCLE_COUNT_AUTHZ=PASS");
console.log("CYCLE_COUNT_SERVER_ACTOR=PASS");
console.log("CYCLE_COUNT_INPUT_BOUNDS=PASS");
console.log("CYCLE_COUNT_ATOMIC_RESULT_LIFECYCLE=PASS");
console.log("CYCLE_COUNT_DIRECT_STOCK_MUTATION=NONE");
