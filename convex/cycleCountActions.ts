import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { requireCapability } from "./authGuard";
import { getSupabaseConfig } from "./supabaseGateway";
import { publishRealtimePulse } from "./realtimePulsePublisher";
import { CYCLE_FREQUENCIES, validateCycleLines, type CycleSession, type CycleWip } from "./cycleCountContract";

const uuid = (value: string) => {
 if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new Error("Invalid cycle count ID");
 return value;
};
async function request<T>(path: string, body?: unknown): Promise<T> {
 const { url, serviceKey } = getSupabaseConfig();
 const response = await fetch(url + "/rest/v1/" + path, {
  method: body === undefined ? "GET" : "POST",
  headers: { apikey: serviceKey, Authorization: "Bearer " + serviceKey, "Content-Type": "application/json" },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
 });
 if (!response.ok) {
  const payload = await response.json().catch(() => ({}));
  const message = String(payload.message ?? "");
  // Only intentional, prefixed business errors cross the browser boundary.
  if (/^(Cycle count (conflict|session|part|operation)|Counts must|Counted parts require|Stock changed during count|DHR WIP changed|Reopen this schedule|Save and finish|At least one part)/.test(message)) throw new Error(message);
  throw new Error("Cycle count request failed (" + response.status + "). Your current entries are preserved.");
 }
 return response.json();
}
async function enabled(ctx: Parameters<typeof requireCapability>[0]) {
 const value = await (ctx as import("./_generated/server").ActionCtx).runQuery(internal.configActions.getConfigValueInternal, { key: "features.cycleCountEnabled" });
 if (value === false) throw new Error("Cycle count is disabled in settings");
}
const mapSchedule = (row: any) => ({ _id: row.id, name: row.name, frequency: row.frequency, assignedTo: row.assigned_to, nextDue: row.next_due, status: row.status, parts: row.parts, countType: row.count_type });
const mapResult = (row: any) => ({ _id: row.id, scheduleId: row.schedule_id, timestamp: row.timestamp, countedBy: row.counted_by, results: row.results, status: row.status, sortMode: row.sort_mode, wipSerials: row.wip_serials });
async function summary() {
 const [schedules, results] = await Promise.all([
  request<any[]>("cycle_schedules?select=*&status=neq.deleted&order=next_due.asc,id.asc&limit=1001"),
  request<any[]>("cycle_results?select=*&archived=eq.false&order=timestamp.desc,id.asc&limit=51"),
 ]);
 if (schedules.length > 1000) throw new Error("Too many schedules to display");
 return { schedules: schedules.map(mapSchedule), results: results.slice(0, 50).map(mapResult), moreHistory: results.length > 50 };
}
export const loadSummary = action({
 args: {}, returns: v.any(), handler: async ctx => { await requireCapability(ctx, "inventory.read"); return summary(); },
});
export const loadData = action({
 args: {}, returns: v.any(), handler: async ctx => {
  await requireCapability(ctx, "inventory.read");
  const [data, wip] = await Promise.all([summary(), request<CycleWip>("rpc/read_cycle_count_wip", {})]);
  if (wip.parts.length > 5000) throw new Error("Too many stock parts for a cycle count");
  return { ...data, wip };
 },
});
export const mutateSchedule = action({
 args: { operation: v.union(v.literal("createSchedule"),v.literal("updateSchedule"),v.literal("deleteSchedule"),v.literal("deleteResult")), payload: v.any(), correlationId: v.string() },
 returns: v.any(), handler: async (ctx, args) => {
  const actor = await requireCapability(ctx, args.operation.startsWith("delete") ? "inventory.admin" : "inventory.write"); await enabled(ctx);
  uuid(args.correlationId);
  const p = args.payload;
  if (!p || typeof p !== "object" || Array.isArray(p)) throw new Error("Invalid schedule");
  const keys = args.operation === "createSchedule" ? ["name","frequency","assignedTo","startDate","parts","countType"] : args.operation === "updateSchedule" ? ["id","name","frequency","assignedTo","nextDue","status"] : ["id"];
  if (Object.keys(p).some(key => !keys.includes(key))) throw new Error("Unsupported schedule field");
  if (args.operation !== "createSchedule") uuid(p.id);
  for (const key of ["name","assignedTo"]) if (p[key] !== undefined && (typeof p[key] !== "string" || !p[key].trim() || p[key].length > 120)) throw new Error("Schedule names must contain 1–120 characters");
  if (p.frequency !== undefined && !CYCLE_FREQUENCIES.includes(p.frequency)) throw new Error("Invalid schedule frequency");
  if (args.operation === "createSchedule" && (!p.name || !p.frequency || !Array.isArray(p.parts) || p.parts.length < 1 || p.parts.length > 5000 || p.parts.some((x: unknown) => typeof x !== "string" || !x.trim() || x.length > 96))) throw new Error("Select valid schedule parts");
  for (const key of ["startDate","nextDue"]) if (p[key] !== undefined && (!Number.isSafeInteger(p[key]) || p[key] < 0)) throw new Error("Invalid schedule date");
  if (p.countType !== undefined && !["standard","w2w"].includes(p.countType)) throw new Error("Invalid count type");
  const result = await request("rpc/apply_cycle_count_operation", { p_operation: args.operation, p_payload: p, p_actor: String(actor), p_correlation_id: args.correlationId });
  await publishRealtimePulse(ctx); return result;
 },
});
export const startSession = action({
 args: { id: v.string(), scopeMode: v.union(v.literal("standard"),v.literal("w2w")), correlationId: v.string() }, returns: v.any(),
 handler: async (ctx,args) => {
  const actor = await requireCapability(ctx,"inventory.write"); await enabled(ctx); uuid(args.id); uuid(args.correlationId);
  const receipt = await request<{sessionId: string}>("rpc/apply_cycle_count_operation",{p_operation:"start",p_payload:{id:args.id,scopeMode:args.scopeMode},p_actor:String(actor),p_correlation_id:args.correlationId});
  const [sessions,wip] = await Promise.all([request<CycleSession[]>("cycle_count_sessions?select=*&id=eq."+uuid(receipt.sessionId)+"&limit=1"),request<CycleWip>("rpc/read_cycle_count_wip",{})]);
  if (!sessions[0]) throw new Error("Cycle count session not found");
  return {session:sessions[0],wip};
 },
});
export const saveSession = action({
 args: {
  operation: v.union(v.literal("save"),v.literal("pause"),v.literal("confirm")), sessionId:v.string(), expectedRevision:v.number(),
  sortMode:v.union(v.literal("alpha"),v.literal("w2w")), correlationId:v.string(), wipFingerprint:v.optional(v.string()), adjustmentBasis:v.optional(v.union(v.literal("counted"),v.literal("counted_wip_incoming"))),
  lines:v.array(v.object({partNumber:v.string(),countedQty:v.union(v.number(),v.null()),incomingQty:v.union(v.number(),v.null()),stockToken:v.union(v.string(),v.null())})),
 },
 returns:v.any(), handler:async(ctx,args)=>{
  const actor=await requireCapability(ctx,args.operation==="confirm"?"inventory.admin":"inventory.write");await enabled(ctx);
  uuid(args.sessionId);uuid(args.correlationId);validateCycleLines(args.lines);
  if(!Number.isSafeInteger(args.expectedRevision)||args.expectedRevision<0)throw new Error("Invalid session revision");
  if(args.operation==="confirm"&&!args.adjustmentBasis)throw new Error("Choose the stock adjustment basis before confirming");
  const {operation,correlationId,...payload}=args;
  const result=await request("rpc/apply_cycle_count_operation",{p_operation:operation,p_payload:payload,p_actor:String(actor),p_correlation_id:correlationId});
  if(operation==="confirm"||operation==="pause")await publishRealtimePulse(ctx);
  return result;
 },
});
