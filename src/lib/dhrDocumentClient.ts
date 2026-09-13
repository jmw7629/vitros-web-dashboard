import type { DigitalDhrPartConsumptionEvent, DigitalDhrConsumptionReceipt } from "./dhrDocumentContract";
import {
  DhrClientError, assertMatchingDhrReceipt, canonicalDhrEvent, dhrConflictEvidence, MAX_DHR_OUTSTANDING_EVENTS,
  type DhrPendingStore, type DhrQueueFailure, type DhrEnqueueResult, type DhrPendingEvent, type DhrConflictEvidence,
} from "./dhrDocumentQueue";

const messages: Record<string, string> = {
  disabled: "Digital DHR consumption is disabled. The pending edit was retained.",
  not_found: "The server could not find this document, field, or part. Review the binding before retrying.",
  validation: "The server rejected this edit. Review the document field before retrying.",
  conflict: "The field or inventory changed on the server. Refresh and review the conflict; the submitted quantity was retained.",
  insufficient_stock: "There is insufficient stock for this edit. The pending edit was retained.",
  identity_unavailable: "The server could not resolve the operator identity. Sign in and review before retrying.",
  unavailable: "The result could not be confirmed. Retry will use the same event and idempotency key.",
  protocol: "The server receipt does not match this edit. The pending edit was retained.",
  storage: "The receipt could not be stored durably. Retry will use the same event and idempotency key.",
};
function failure(error: unknown): DhrQueueFailure {
  const object = error && typeof error === "object" ? error as { code?: unknown; data?: unknown } : {};
  const nested = object.data && typeof object.data === "object" ? object.data as { code?: unknown } : {};
  const candidate = error instanceof DhrClientError ? error.code : nested.code ?? object.code;
  const code = typeof candidate === "string" && Object.prototype.hasOwnProperty.call(messages, candidate) ? candidate : "unavailable";
  return { code: code as DhrQueueFailure["code"], message: messages[code], retryable: code === "unavailable" || code === "storage" };
}
export type DhrFlushResult = { acknowledged: number; pending: number; conflicts: number; failed: number; refreshPending: number };
export type DhrConflictReview = { reviewId: string; event: DigitalDhrPartConsumptionEvent; evidence: DhrConflictEvidence; reviewedAt: number };
export type DhrDocumentClientOptions = {
  store: DhrPendingStore;
  // Bind to the current authenticated account/session owner; no scope value is
  // sent as an actor claim. The server independently resolves identity.
  scope: string;
  currentScope: () => string | null;
  transport: (event: DigitalDhrPartConsumptionEvent) => Promise<unknown>;
  // Authenticated server state transport, invoked only for an explicit conflict
  // review. Never supply a renderer-authored manifest as authoritative state.
  getDocumentState?: (documentInstanceId: string) => Promise<unknown>;
  afterAcknowledged: (receipt: DigitalDhrConsumptionReceipt) => Promise<void>;
  enabled?: () => boolean;
  now?: () => number;
  ownerId?: string;
  leaseMs?: number;
};

// Construction/import performs no network, database open, timer, listener, or
// automatic replay. The renderer explicitly commits edits and invokes flush.
export function createDhrDocumentClient(options: DhrDocumentClientOptions) {
  const enabled = options.enabled ?? (() => false);
  const now = options.now ?? Date.now;
  const owner = options.ownerId ?? globalThis.crypto.randomUUID();
  const leaseMs = options.leaseMs ?? 45_000;
  if (!options.scope || options.scope.length > 250) throw new DhrClientError("validation", "An authenticated queue owner is required.");
  if (!Number.isFinite(leaseMs) || leaseMs < 1_000 || leaseMs > 300_000) throw new DhrClientError("validation", "Invalid submission lease duration.");
  let running: Promise<DhrFlushResult> | undefined;
  const reviews = new Map<string, { record: DhrPendingEvent; evidence: DhrConflictEvidence; reviewedAt: number }>();
  function requireCurrentScope() { if (options.currentScope() !== options.scope) throw new DhrClientError("identity_unavailable", "This queue belongs to a different signed-in account. Pending edits were retained for their original owner."); }
  function requireEnabled() { if (!enabled()) throw new DhrClientError("disabled", messages.disabled); requireCurrentScope(); }

  async function refreshAcknowledged(): Promise<void> {
    for (const item of await options.store.acknowledged(options.scope)) {
      if (!item.refreshPending || !enabled()) continue;
      requireCurrentScope();
      try { await options.afterAcknowledged(item.receipt); requireCurrentScope(); await options.store.markRefreshed(options.scope, item.event.eventId); }
      catch { /* Refresh failure never re-enqueues or re-consumes an accepted edit. */ }
    }
  }
  async function performFlush(maxEvents: number): Promise<DhrFlushResult> {
    requireEnabled(); await refreshAcknowledged(); let acknowledged = 0;
    for (let count = 0; count < maxEvents; count++) {
      requireEnabled();
      const record = await options.store.claim(options.scope, owner, now(), leaseMs);
      if (!record) break;
      try {
        requireEnabled();
        // The claimed exact event is already committed to IndexedDB. A lost
        // response never generates a replacement event or edits its quantity.
        const response = await options.transport(canonicalDhrEvent(record.event));
        requireCurrentScope();
        assertMatchingDhrReceipt(record.event, response);
        await options.store.acknowledge(record, response); acknowledged++;
      } catch (error) {
        const problem = failure(error);
        const delay = Math.min(60_000, 1_000 * (2 ** Math.min(record.attempts - 1, 6)));
        await options.store.fail(record, owner, problem, now() + (problem.retryable ? delay : 0));
      }
    }
    await refreshAcknowledged();
    const pending = await options.store.pending(options.scope);
    const receipts = await options.store.acknowledged(options.scope);
    return { acknowledged, pending: pending.length, conflicts: pending.filter((item) => item.status === "conflict").length, failed: pending.filter((item) => item.status === "failed").length, refreshPending: receipts.filter((item) => item.refreshPending).length };
  }
  function flush(maxEvents = 100): Promise<DhrFlushResult> {
    requireEnabled();
    if (!Number.isInteger(maxEvents) || maxEvents < 1 || maxEvents > 1_000) throw new DhrClientError("validation", "Invalid flush batch size.");
    if (!running) running = performFlush(maxEvents).finally(() => { running = undefined; });
    return running;
  }
  async function enqueue(event: DigitalDhrPartConsumptionEvent): Promise<DhrEnqueueResult> {
    requireEnabled(); return options.store.enqueue(options.scope, canonicalDhrEvent(event), now());
  }
  async function fetchState(documentInstanceId: string): Promise<unknown> {
    requireEnabled();
    if (!options.getDocumentState) throw new DhrClientError("unavailable", "Conflict review requires a current authenticated server document state.");
    try { const state = await options.getDocumentState(documentInstanceId); requireEnabled(); return state; }
    catch (error) { const problem = failure(error); throw new DhrClientError(problem.code, problem.message); }
  }
  async function reviewConflict(eventId: string): Promise<DhrConflictReview> {
    requireEnabled();
    const record = (await options.store.pending(options.scope)).find((item) => item.event.eventId === eventId);
    if (!record || record.status !== "conflict" || record.failure?.code !== "conflict") throw new DhrClientError("local_conflict", "Only a definitive server conflict can be reviewed for retirement. Unconfirmed edits must be retried unchanged.");
    const state = await fetchState(record.event.documentInstanceId);
    const evidence = dhrConflictEvidence(record.event, state); const reviewedAt = now();
    for (const [id, review] of reviews) if (review.record.key === record.key) reviews.delete(id);
    if (reviews.size >= MAX_DHR_OUTSTANDING_EVENTS) throw new DhrClientError("storage", "Too many conflict reviews are open. Finish the existing reviews before opening another.");
    const reviewId = globalThis.crypto.randomUUID(); reviews.set(reviewId, { record, evidence, reviewedAt });
    return { reviewId, event: canonicalDhrEvent(record.event), evidence: { ...evidence }, reviewedAt };
  }
  // Call only after the user reviews the original intent and displayed accepted
  // state. Fetch again: changes since that review require another explicit review.
  // Neither retirement nor this API rebases quantities or submits successors.
  async function resolveConflict(reviewId: string) {
    requireEnabled(); const review = reviews.get(reviewId);
    if (!review) throw new DhrClientError("local_conflict", "Open a fresh conflict review before resolving this edit.");
    const state = await fetchState(review.record.event.documentInstanceId);
    const evidence = dhrConflictEvidence(review.record.event, state);
    if (JSON.stringify(evidence) !== JSON.stringify(review.evidence)) {
      reviews.delete(reviewId);
      throw new DhrClientError("conflict", "The server field changed since review. Review its latest state before resolving this edit.");
    }
    requireEnabled();
    const resolution = await options.store.resolveConflict(review.record, state, review.reviewedAt, now());
    reviews.delete(reviewId); return resolution;
  }
  return {
    enqueue, flush, reviewConflict, resolveConflict,
    async commit(event: DigitalDhrPartConsumptionEvent) { const queued = await enqueue(event); const result = await flush(); return { queued, result }; },
    async retry(eventId: string) { requireEnabled(); await options.store.retry(options.scope, eventId, now()); return flush(); },
    pending: () => { requireCurrentScope(); return options.store.pending(options.scope); },
    acknowledged: () => { requireCurrentScope(); return options.store.acknowledged(options.scope); },
    resolutions: () => { requireCurrentScope(); return options.store.resolutions(options.scope); },
  };
}
