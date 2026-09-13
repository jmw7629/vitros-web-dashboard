import {
  validateDigitalDhrEvent, validateDigitalDhrReceipt, validateDhrDocumentState,
  type DigitalDhrPartConsumptionEvent, type DigitalDhrConsumptionReceipt, type DhrBridgeErrorCode,
} from "./dhrDocumentContract";

export type DhrClientErrorCode = DhrBridgeErrorCode | "storage" | "local_conflict" | "protocol";
export class DhrClientError extends Error {
  readonly code: DhrClientErrorCode;
  constructor(code: DhrClientErrorCode, message: string) { super(message); this.code = code; this.name = "DhrClientError"; }
}
export type DhrQueueFailure = { code: DhrClientErrorCode; message: string; retryable: boolean };
export type DhrPendingEvent = {
  key: string; scope: string; fieldKey: string; revisionKey: string; requestKey: string;
  event: DigitalDhrPartConsumptionEvent; eventJson: string;
  status: "pending" | "sending" | "failed" | "conflict";
  createdAt: number; attempts: number; nextAttemptAt: number;
  leaseOwner?: string; leaseUntil?: number; failure?: DhrQueueFailure;
};
export type DhrAcknowledgedEvent = {
  key: string; scope: string; revisionKey: string; requestKey: string;
  event: DigitalDhrPartConsumptionEvent; eventJson: string;
  receipt: DigitalDhrConsumptionReceipt; refreshPending: boolean;
};
export type DhrEnqueueResult = { kind: "pending"; pending: DhrPendingEvent } | { kind: "acknowledged"; acknowledged: DhrAcknowledgedEvent };
export const MAX_DHR_OUTSTANDING_EVENTS = 1_000;
export const MAX_DHR_CONFLICT_RESOLUTIONS = 1_000;
export type DhrConflictEvidence = {
  sessionId: string; artifactSha256: string; acceptedFieldVersion: number;
  acceptedQuantity: number; inventoryConflict: boolean; bindingKind: "consumable_part" | "tool";
};
export type DhrResolvedConflict = {
  key: string; scope: string; revisionKey: string; requestKey: string;
  event: DigitalDhrPartConsumptionEvent; eventJson: string;
  evidence: DhrConflictEvidence; reviewedAt: number; resolvedAt: number;
};

// A current accepted version proves this exact older event can no longer change
// that field. A manual scanner conflict with an earlier version is not proof.
export function dhrConflictEvidence(event: DigitalDhrPartConsumptionEvent, state: unknown): DhrConflictEvidence {
  try { validateDhrDocumentState(state); }
  catch { throw new DhrClientError("protocol", "The current document state could not be verified. The conflict was retained."); }
  const binding = state.manifest.bindings.find((item) => item.fieldId === event.fieldId);
  const field = state.fields.find((item) => item.fieldId === event.fieldId);
  if (state.documentInstanceId !== event.documentInstanceId || state.documentTemplateId !== event.documentTemplateId || state.documentRevision !== event.documentRevision || state.instrumentSn !== event.instrumentSn || state.woNumber !== (event.woNumber ?? null) || binding?.sectionId !== event.sectionId || binding.partNumber !== event.partNumber || !field) throw new DhrClientError("protocol", "The current document state does not match this pending edit. The conflict was retained.");
  if (field.fieldVersion < event.fieldVersion) throw new DhrClientError("conflict", "The server has not accepted this field version. This conflict requires server reconciliation and cannot be retired locally.");
  return { sessionId: state.sessionId, artifactSha256: state.manifest.artifactSha256, acceptedFieldVersion: field.fieldVersion, acceptedQuantity: field.quantity, inventoryConflict: field.conflict, bindingKind: binding.kind };
}

// Only the versioned event contract is stored. This is not a document cache or
// a client-side manifest registry, and it never establishes server authority.
export function canonicalDhrEvent(value: unknown): DigitalDhrPartConsumptionEvent {
  validateDigitalDhrEvent(value);
  return {
    eventId: value.eventId, idempotencyKey: value.idempotencyKey,
    documentInstanceId: value.documentInstanceId, documentTemplateId: value.documentTemplateId,
    documentRevision: value.documentRevision, fieldId: value.fieldId, fieldVersion: value.fieldVersion,
    sectionId: value.sectionId, partNumber: value.partNumber, previousQuantity: value.previousQuantity,
    quantity: value.quantity, instrumentSn: value.instrumentSn,
    ...(value.woNumber === undefined ? {} : { woNumber: value.woNumber }), occurredAt: value.occurredAt,
  };
}
export function assertMatchingDhrReceipt(event: DigitalDhrPartConsumptionEvent, value: unknown): asserts value is DigitalDhrConsumptionReceipt {
  try { validateDigitalDhrReceipt(value); }
  catch { throw new DhrClientError("protocol", "The server receipt could not be verified. The pending edit was retained."); }
  for (const [key, expected] of Object.entries(canonicalDhrEvent(event))) {
    if (value[key as keyof DigitalDhrConsumptionReceipt] !== expected) throw new DhrClientError("protocol", "The server receipt does not match this pending edit.");
  }
  if (value.woNumber !== (event.woNumber ?? null)) throw new DhrClientError("protocol", "The server receipt does not match this pending edit.");
}

const key = (...parts: (string | number)[]) => JSON.stringify(parts);
const request = <T>(operation: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  operation.onsuccess = () => resolve(operation.result);
  operation.onerror = () => reject(operation.error ?? new Error("IndexedDB request failed"));
});

export interface DhrPendingStore {
  enqueue(scope: string, event: DigitalDhrPartConsumptionEvent, now: number): Promise<DhrEnqueueResult>;
  pending(scope: string): Promise<DhrPendingEvent[]>;
  acknowledged(scope: string): Promise<DhrAcknowledgedEvent[]>;
  claim(scope: string, owner: string, now: number, leaseMs: number): Promise<DhrPendingEvent | null>;
  fail(record: DhrPendingEvent, owner: string, failure: DhrQueueFailure, nextAttemptAt: number): Promise<void>;
  acknowledge(record: DhrPendingEvent, receipt: DigitalDhrConsumptionReceipt): Promise<DhrAcknowledgedEvent>;
  markRefreshed(scope: string, eventId: string): Promise<void>;
  retry(scope: string, eventId: string, now: number): Promise<void>;
  resolveConflict(record: DhrPendingEvent, state: unknown, reviewedAt: number, resolvedAt: number): Promise<DhrResolvedConflict>;
  resolutions(scope: string): Promise<DhrResolvedConflict[]>;
  close(): Promise<void>;
}

export class IndexedDbDhrPendingStore implements DhrPendingStore {
  private connection: Promise<IDBDatabase> | undefined;
  private readonly factory: IDBFactory | undefined;
  private readonly databaseName: string;
  constructor(factory: IDBFactory | undefined = globalThis.indexedDB, databaseName = "vitros-digital-dhr-pending-v1") { this.factory = factory; this.databaseName = databaseName; }

  private database(): Promise<IDBDatabase> {
    if (!this.factory) return Promise.reject(new DhrClientError("storage", "Durable browser storage is unavailable. The edit was not submitted."));
    if (!this.connection) {
      this.connection = new Promise<IDBDatabase>((resolve, reject) => {
        const operation = this.factory!.open(this.databaseName, 2);
        let rejected = false;
        operation.onupgradeneeded = () => {
          for (const name of ["pending", "acknowledged", "resolved"]) {
            if (operation.result.objectStoreNames.contains(name)) continue;
            const store = operation.result.createObjectStore(name, { keyPath: "key" });
            store.createIndex("scope", "scope");
            store.createIndex("revision", "revisionKey", { unique: true });
            store.createIndex("request", "requestKey", { unique: true });
          }
        };
        operation.onsuccess = () => {
          const db = operation.result;
          if (rejected) { db.close(); return; }
          db.onversionchange = () => { db.close(); this.connection = undefined; };
          resolve(db);
        };
        operation.onerror = () => { this.connection = undefined; reject(new DhrClientError("storage", "Durable browser storage could not be opened. The edit was not submitted.")); };
        operation.onblocked = () => { rejected = true; this.connection = undefined; reject(new DhrClientError("storage", "Another browser tab is blocking durable storage. The edit was not submitted.")); };
      });
    }
    return this.connection;
  }

  private async transaction<T>(names: string[], mode: IDBTransactionMode, work: (tx: IDBTransaction) => Promise<T>): Promise<T> {
    const db = await this.database();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(names, mode);
      let value: T; let complete = false; let failure: unknown;
      tx.oncomplete = () => complete ? resolve(value) : reject(new DhrClientError("storage", "Durable storage did not complete the operation."));
      tx.onabort = () => reject(failure instanceof DhrClientError ? failure : new DhrClientError("storage", "Durable storage failed. The pending edit was not discarded."));
      // Only IndexedDB requests are awaited inside this transaction. No network,
      // timers, callbacks to the renderer, or other external promises run here.
      void work(tx).then((result) => { value = result; complete = true; }).catch((error) => {
        failure = error;
        try { tx.abort(); } catch { reject(error); }
      });
    });
  }

  async enqueue(scope: string, supplied: DigitalDhrPartConsumptionEvent, now: number): Promise<DhrEnqueueResult> {
    if (!scope || scope.length > 250) throw new DhrClientError("validation", "An authenticated queue scope is required.");
    const event = canonicalDhrEvent(supplied); const eventJson = JSON.stringify(event);
    const record: DhrPendingEvent = {
      key: key(scope, event.eventId), scope, fieldKey: key(scope, event.documentInstanceId, event.fieldId),
      revisionKey: key(scope, event.documentInstanceId, event.fieldId, event.fieldVersion), requestKey: key(scope, event.idempotencyKey),
      event, eventJson, status: "pending", createdAt: now, attempts: 0, nextAttemptAt: now,
    };
    return this.transaction(["pending", "acknowledged", "resolved"], "readwrite", async (tx) => {
      const resolved = tx.objectStore("resolved");
      if (await request(resolved.get(record.key)) || await request(resolved.index("revision").get(record.revisionKey)) || await request(resolved.index("request").get(record.requestKey))) throw new DhrClientError("local_conflict", "This field version or event identity was already retired after conflict review. Commit a new edit from current server state.");
      for (const name of ["pending", "acknowledged"] as const) {
        const store = tx.objectStore(name);
        const existing = await request(store.get(record.key)) as DhrPendingEvent | DhrAcknowledgedEvent | undefined;
        if (existing) {
          if (existing.eventJson !== eventJson) throw new DhrClientError("local_conflict", "This event ID already belongs to a different edit.");
          return name === "pending" ? { kind: "pending", pending: existing as DhrPendingEvent } : { kind: "acknowledged", acknowledged: existing as DhrAcknowledgedEvent };
        }
        for (const [index, identity] of [["revision", record.revisionKey], ["request", record.requestKey]]) {
          if (await request(store.index(index).get(identity))) throw new DhrClientError("local_conflict", "Another committed edit already owns this field version or idempotency key. Refresh the field state before committing another edit.");
        }
      }
      const pendingCount = await request(tx.objectStore("pending").index("scope").count(scope));
      const receiptCount = await request(tx.objectStore("acknowledged").index("scope").count(scope));
      if (pendingCount + receiptCount >= MAX_DHR_OUTSTANDING_EVENTS) throw new DhrClientError("storage", "The durable edit queue is full. Sync pending edits before committing another change.");
      await request(tx.objectStore("pending").add(record));
      return { kind: "pending", pending: record };
    });
  }
  pending(scope: string): Promise<DhrPendingEvent[]> {
    return this.transaction(["pending"], "readonly", async (tx) => this.bounded(await request(tx.objectStore("pending").index("scope").getAll(scope, MAX_DHR_OUTSTANDING_EVENTS + 1))));
  }
  acknowledged(scope: string): Promise<DhrAcknowledgedEvent[]> {
    return this.transaction(["acknowledged"], "readonly", async (tx) => this.bounded(await request(tx.objectStore("acknowledged").index("scope").getAll(scope, MAX_DHR_OUTSTANDING_EVENTS + 1))));
  }
  private bounded<T>(rows: T[]): T[] {
    if (rows.length > MAX_DHR_OUTSTANDING_EVENTS) throw new DhrClientError("storage", "The durable queue exceeds its supported capacity. Pending data was retained for recovery.");
    return rows;
  }
  claim(scope: string, owner: string, now: number, leaseMs: number): Promise<DhrPendingEvent | null> {
    return this.transaction(["pending"], "readwrite", async (tx) => {
      const store = tx.objectStore("pending");
      const records = this.bounded(await request(store.index("scope").getAll(scope, MAX_DHR_OUTSTANDING_EVENTS + 1))) as DhrPendingEvent[];
      records.sort((a, b) => a.event.fieldVersion - b.event.fieldVersion || a.createdAt - b.createdAt || a.key.localeCompare(b.key));
      const fields = new Set<string>();
      for (const record of records) {
        if (fields.has(record.fieldKey)) continue;
        fields.add(record.fieldKey);
        if (record.status === "failed" || record.status === "conflict" || record.nextAttemptAt > now || (record.status === "sending" && (record.leaseUntil ?? 0) > now)) continue;
        const claimed: DhrPendingEvent = { ...record, status: "sending", leaseOwner: owner, leaseUntil: now + leaseMs, attempts: record.attempts + 1 };
        await request(store.put(claimed)); return claimed;
      }
      return null;
    });
  }
  fail(record: DhrPendingEvent, owner: string, failure: DhrQueueFailure, nextAttemptAt: number): Promise<void> {
    return this.transaction(["pending"], "readwrite", async (tx) => {
      const store = tx.objectStore("pending"); const current = await request(store.get(record.key)) as DhrPendingEvent | undefined;
      if (!current || current.leaseOwner !== owner || current.eventJson !== record.eventJson) return;
      const { leaseOwner: _owner, leaseUntil: _until, ...rest } = current;
      await request(store.put({ ...rest, failure, nextAttemptAt, status: failure.code === "conflict" ? "conflict" : failure.retryable ? "pending" : "failed" }));
    });
  }
  acknowledge(record: DhrPendingEvent, receipt: DigitalDhrConsumptionReceipt): Promise<DhrAcknowledgedEvent> {
    assertMatchingDhrReceipt(record.event, receipt);
    return this.transaction(["pending", "acknowledged"], "readwrite", async (tx) => {
      const receipts = tx.objectStore("acknowledged");
      const existing = await request(receipts.get(record.key)) as DhrAcknowledgedEvent | undefined;
      if (existing) {
        if (existing.eventJson !== record.eventJson) throw new DhrClientError("protocol", "A conflicting acknowledgment is already stored.");
        return existing;
      }
      const pending = tx.objectStore("pending"); const current = await request(pending.get(record.key)) as DhrPendingEvent | undefined;
      if (!current || current.eventJson !== record.eventJson) throw new DhrClientError("protocol", "The pending edit does not match the server receipt.");
      const acknowledged: DhrAcknowledgedEvent = {
        key: record.key, scope: record.scope, revisionKey: record.revisionKey, requestKey: record.requestKey,
        event: record.event, eventJson: record.eventJson, receipt, refreshPending: true,
      };
      await request(receipts.add(acknowledged)); await request(pending.delete(record.key)); return acknowledged;
    });
  }
  markRefreshed(scope: string, eventId: string): Promise<void> {
    return this.transaction(["acknowledged"], "readwrite", async (tx) => {
      const store = tx.objectStore("acknowledged"); const value = await request(store.get(key(scope, eventId))) as DhrAcknowledgedEvent | undefined;
      // The immutable server ledger owns archival receipts. Once both durable
      // acknowledgment and the stock-refresh notification succeeded, remove the
      // local notification instead of accumulating browser document history.
      if (value?.refreshPending) await request(store.delete(value.key));
    });
  }
  retry(scope: string, eventId: string, now: number): Promise<void> {
    return this.transaction(["pending"], "readwrite", async (tx) => {
      const store = tx.objectStore("pending"); const value = await request(store.get(key(scope, eventId))) as DhrPendingEvent | undefined;
      if (!value) throw new DhrClientError("not_found", "The pending edit was not found.");
      if (value.status === "sending" && (value.leaseUntil ?? 0) > now) throw new DhrClientError("local_conflict", "This edit is already being submitted by another caller.");
      const { leaseOwner: _owner, leaseUntil: _until, failure: _failure, ...rest } = value;
      await request(store.put({ ...rest, status: "pending", nextAttemptAt: now }));
    });
  }
  resolveConflict(record: DhrPendingEvent, state: unknown, reviewedAt: number, resolvedAt: number): Promise<DhrResolvedConflict> {
    const evidence = dhrConflictEvidence(record.event, state);
    return this.transaction(["pending", "resolved"], "readwrite", async (tx) => {
      const pending = tx.objectStore("pending"); const current = await request(pending.get(record.key)) as DhrPendingEvent | undefined;
      if (!current || current.status !== "conflict" || current.failure?.code !== "conflict" || current.eventJson !== record.eventJson) throw new DhrClientError("local_conflict", "Only this exact definitive conflict can be resolved. The edit may have changed or be awaiting confirmation.");
      const resolved = tx.objectStore("resolved");
      if (await request(resolved.index("scope").count(record.scope)) >= MAX_DHR_CONFLICT_RESOLUTIONS) throw new DhrClientError("storage", "The local conflict evidence archive is full. Preserve it for recovery before resolving further conflicts.");
      const resolution: DhrResolvedConflict = { key: record.key, scope: record.scope, revisionKey: record.revisionKey, requestKey: record.requestKey, event: record.event, eventJson: record.eventJson, evidence, reviewedAt, resolvedAt };
      await request(resolved.add(resolution)); await request(pending.delete(record.key)); return resolution;
    });
  }
  resolutions(scope: string): Promise<DhrResolvedConflict[]> {
    return this.transaction(["resolved"], "readonly", async (tx) => {
      const records = await request(tx.objectStore("resolved").index("scope").getAll(scope, MAX_DHR_CONFLICT_RESOLUTIONS + 1)) as DhrResolvedConflict[];
      if (records.length > MAX_DHR_CONFLICT_RESOLUTIONS) throw new DhrClientError("storage", "The local conflict evidence archive exceeds its supported capacity. Data was retained for recovery.");
      return records;
    });
  }
  async close(): Promise<void> { if (this.connection) (await this.connection).close(); this.connection = undefined; }
}
