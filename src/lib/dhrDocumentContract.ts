// Transport-neutral controlled DHR consumption contract. No renderer, credentials,
// real PDF field identifiers, or authoritative production bindings belong here.
export interface DhrPartBinding {
  fieldId: string;
  sectionId: string;
  partNumber: string;
  kind: "consumable_part" | "tool";
  quantityMode: "integer";
  stepReference?: string;
}
export interface DhrBindingManifest {
  schemaVersion: 1;
  templateId: string;
  documentRevision: string;
  analyzerModel: string;
  artifactSha256: string;
  bindings: DhrPartBinding[];
}
export interface DigitalDhrPartConsumptionEvent {
  eventId: string;
  idempotencyKey: string;
  documentInstanceId: string;
  documentTemplateId: string;
  documentRevision: string;
  fieldId: string;
  fieldVersion: number;
  sectionId: string;
  partNumber: string;
  previousQuantity: number;
  quantity: number;
  instrumentSn: string;
  woNumber?: string;
  occurredAt: string;
}
export interface DigitalDhrConsumptionReceipt extends Omit<DigitalDhrPartConsumptionEvent, "woNumber"> {
  woNumber: string | null;
  status: "consumed" | "returned" | "unchanged" | "ignored";
  duplicate: boolean;
  delta: number;
  inventoryPartNumber: string | null;
  stockId: string | null;
  stockBefore: number | null;
  stockAfter: number | null;
  auditId: string | null;
  sapStagingId: string | null;
  correlationId: string;
  operatorId: string;
  operatorInitials: string;
  actor: string;
  processedAt: string;
}
export interface DhrDocumentState {
  documentInstanceId: string;
  sessionId: string;
  documentTemplateId: string;
  documentRevision: string;
  instrumentSn: string;
  woNumber: string | null;
  status: string;
  manifest: DhrBindingManifest;
  fields: Array<{fieldId: string; fieldVersion: number; quantity: number; conflict: boolean}>;
}
export type DhrBridgeErrorCode = "disabled" | "not_found" | "validation" | "conflict" | "insufficient_stock" | "identity_unavailable" | "unavailable";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const eventKeys = ["eventId","idempotencyKey","documentInstanceId","documentTemplateId","documentRevision","fieldId","fieldVersion","sectionId","partNumber","previousQuantity","quantity","instrumentSn","woNumber","occurredAt"];
function fail(): never { throw new Error("Invalid digital DHR contract"); }
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail();
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some(key => !keys.includes(key))) fail();
  return record;
}
function text(value: unknown, max: number): asserts value is string {
  if (typeof value !== "string" || !value || value !== value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) fail();
}
function whole(value: unknown, minimum = 0, maximum = 1_000_000): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) fail();
}
function uuid(value: unknown): void { if (typeof value !== "string" || !UUID.test(value)) fail(); }
function timestamp(value: unknown): void {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) fail();
  const day=value.slice(0,10);
  const calendar=new Date(`${day}T00:00:00Z`);
  if(!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0,10)!==day || Number(value.slice(11,13))>23 || Number(value.slice(14,16))>59 || Number(value.slice(17,19))>59)fail();
}
export function validateDhrBindingManifest(value: unknown): asserts value is DhrBindingManifest {
  const m = object(value,["schemaVersion","templateId","documentRevision","analyzerModel","artifactSha256","bindings"]);
  if (m.schemaVersion !== 1 || typeof m.artifactSha256 !== "string" || !/^[a-f0-9]{64}$/.test(m.artifactSha256)) fail();
  text(m.templateId,160);text(m.documentRevision,40);text(m.analyzerModel,40);
  if (!Array.isArray(m.bindings) || m.bindings.length < 1 || m.bindings.length > 500) fail();
  const fields = new Set<string>();
  for (const binding of m.bindings) {
    const b=object(binding,["fieldId","sectionId","partNumber","kind","quantityMode","stepReference"]);
    text(b.fieldId,160);text(b.sectionId,80);text(b.partNumber,120);
    if (b.partNumber !== b.partNumber.toUpperCase() || b.quantityMode !== "integer" || !["consumable_part","tool"].includes(String(b.kind))) fail();
    if (b.stepReference !== undefined) text(b.stepReference,160);
    if (fields.has(b.fieldId)) fail();
    fields.add(b.fieldId);
  }
}
function eventFields(e: Record<string,unknown>, receipt=false): void {
  uuid(e.eventId);uuid(e.idempotencyKey);uuid(e.documentInstanceId);
  text(e.documentTemplateId,160);text(e.documentRevision,40);text(e.fieldId,160);text(e.sectionId,80);
  text(e.partNumber,120);text(e.instrumentSn,80);
  if (e.partNumber !== (e.partNumber as string).toUpperCase()) fail();
  if (e.woNumber !== undefined && !(receipt && e.woNumber === null)) text(e.woNumber,120);
  whole(e.fieldVersion,1);whole(e.previousQuantity);whole(e.quantity);timestamp(e.occurredAt);
}
export function validateDigitalDhrEvent(value: unknown): asserts value is DigitalDhrPartConsumptionEvent {
  eventFields(object(value,eventKeys));
}
export function validateDigitalDhrReceipt(value: unknown): asserts value is DigitalDhrConsumptionReceipt {
  const r=object(value,[...eventKeys,"status","duplicate","delta","inventoryPartNumber","stockId","stockBefore","stockAfter","auditId","sapStagingId","correlationId","operatorId","operatorInitials","actor","processedAt"]);
  eventFields(r,true);
  if (typeof r.duplicate !== "boolean" || !["consumed","returned","unchanged","ignored"].includes(String(r.status))) fail();
  if (r.woNumber === undefined) fail();
  whole(r.delta,-1_000_000);text(r.correlationId,100);text(r.operatorId,200);text(r.operatorInitials,40);text(r.actor,250);timestamp(r.processedAt);
  if(r.correlationId!==`digital-dhr:${r.idempotencyKey}`)fail();
  for (const key of ["stockBefore","stockAfter"]) if (r[key] !== null) whole(r[key],0,2_147_483_647);
  for (const key of ["auditId","sapStagingId"]) if (r[key] !== null) uuid(r[key]);
  if (r.delta !== (r.status === "ignored" ? 0 : (r.quantity as number)-(r.previousQuantity as number))) fail();
  if (r.status === "ignored") {
    if (r.inventoryPartNumber !== null || r.stockId !== null || r.stockBefore !== null || r.stockAfter !== null || r.auditId !== null || r.sapStagingId !== null) fail();
  } else {
    text(r.inventoryPartNumber,120);uuid(r.stockId);
    if(r.inventoryPartNumber!==r.inventoryPartNumber.toUpperCase())fail();
    if (r.stockBefore === null || r.stockAfter === null || r.stockAfter !== (r.stockBefore as number)-(r.delta as number)) fail();
    const status=(r.delta as number)>0?"consumed":(r.delta as number)<0?"returned":"unchanged";
    if (r.status!==status || ((r.delta as number)!==0 && (r.auditId===null || r.sapStagingId===null))) fail();
    if(r.delta===0 && (r.auditId!==null || r.sapStagingId!==null))fail();
  }
}
export function validateDhrDocumentState(value: unknown): asserts value is DhrDocumentState {
  const s=object(value,["documentInstanceId","sessionId","documentTemplateId","documentRevision","instrumentSn","woNumber","status","manifest","fields"]);
  uuid(s.documentInstanceId);uuid(s.sessionId);text(s.documentTemplateId,160);text(s.documentRevision,40);text(s.instrumentSn,80);text(s.status,40);
  if(s.woNumber!==null)text(s.woNumber,120);
  validateDhrBindingManifest(s.manifest);
  if(s.manifest.templateId!==s.documentTemplateId || s.manifest.documentRevision!==s.documentRevision || !Array.isArray(s.fields) || s.fields.length!==s.manifest.bindings.length)fail();
  const ids=new Set(s.manifest.bindings.map(b=>b.fieldId));
  for(const field of s.fields){
    const f=object(field,["fieldId","fieldVersion","quantity","conflict"]);
    text(f.fieldId,160);whole(f.fieldVersion);whole(f.quantity);
    if(typeof f.conflict!=="boolean" || !ids.delete(f.fieldId))fail();
  }
}
