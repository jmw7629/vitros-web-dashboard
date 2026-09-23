import { useEffect, useMemo, useRef, useState } from "react";
import { useAction } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Camera, Check, FileImage, Hash, Loader2, Plus, RefreshCw, Trash2, Upload } from "lucide-react";
import { WebCard, theme } from "../../components/vitros/SharedComponents";
import { useConvexData } from "../../hooks/useConvexData";
import { safeAiError, safeOcrError } from "../../lib/aiErrors";

type MatchStatus =
  | "matched"
  | "unknown_part"
  | "ambiguous_part"
  | "invalid_part_number"
  | "invalid_quantity"
  | "needs_review";

type CommitStatus = "idle" | "committing" | "received" | "failed";

type ConfirmedReceiveRequest = {
  partNumber: string; qty: number; confirmationId: string; documentRef: string;
  sourcePage?: string; sourceLineNo: number;
};
const receiptReference = (value: string) => value.trim().toUpperCase().replace(/\s+/g, " ");

type RecoveryAttempt = {
  attemptId: string;
  state: "reviewed" | "attempted" | "accepted" | "unknown" | "conflict";
  revision: number;
  documentRef: string;
  sourcePage: string | null;
  sourceLineNo: number;
  partNumber: string;
  qty: number;
  correlationId: string;
  batchId: string;
  receipt?: Record<string, unknown> | null;
};

interface ReviewLine {
  lineNo: number;
  partNumberOcr: string;
  partNumberCanonical: string;
  descriptionOcr: string;
  qtyOcr: number | null;
  confidence: number | null;
  matchStatus: Exclude<MatchStatus, "needs_review">;
  resolvedPartNumber: string | null;
  stockId: string | null;
  stockDescription: string | null;
  qtyOnHand: number | null;
  sourcePage: string | null;
  sourceLineNo: number;
  deterministicIdentity: string | null;
}

interface AggregateSummaryLine {
  canonicalPartNumber: string;
  totalQty: number;
  lineCount: number;
  matchedCount: number;
}

interface ReviewResponse {
  documentRef: string | null;
  requiresHumanConfirmation: boolean;
  identityRule: string;
  descriptionUsedForIdentity: boolean;
  quantityRule: string;
  lines: ReviewLine[];
  summary: Record<string, number>;
  aggregateSummary: AggregateSummaryLine[];
}

interface IncomingLine {
  id: string;
  confirmationId: string;
  reviewedDocumentRef: string;
  sourceLineNo: number;
  partNumber: string;
  description: string;
  qty: number;
  orderedQty: number | null;
  confidence: number | null;
  matchStatus: MatchStatus;
  resolvedPartNumber: string | null;
  stockDescription: string | null;
  qtyOnHand: number | null;
  selected: boolean;
  commitStatus: CommitStatus;
  message: string | null;
  sourcePage: string | null;
  deterministicIdentity: string | null;
  attemptId?: string;
  attemptRevision?: number;
}

function makeId(prefix: string) {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`;
}

function safeError(error: unknown) {
  const aiError = safeAiError(error);
  if (aiError) return aiError;
  const message = error instanceof Error ? error.message : "Operation failed";
  if (/ambiguous/i.test(message)) return "Part number is ambiguous in Stock Summary. Nothing was received.";
  if (/not present|not found/i.test(message)) return "Part number is not present in Stock Summary. Nothing was received.";
  if (/quantity/i.test(message)) return "Receive quantity must be a positive whole number.";
  if (/capability|authenticated|unauthorized/i.test(message)) return "Your authenticated session is not authorized for Incoming Stock receiving.";
  if (/document reference is required/i.test(message)) return "Document / Delivery / PO reference is required for deterministic receipt identity.";
  return message.slice(0, 220);
}

async function imageToBase64(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Upload a packing-list image (JPG, PNG, HEIC-compatible browser image). PDF intake is not enabled in this browser build yet.");
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Unable to read image"));
    reader.readAsDataURL(file);
  });
  const comma = dataUrl.indexOf(",");
  if (comma < 0) throw new Error("Unable to read image");
  return dataUrl.slice(comma + 1);
}

function parseOcrArray(raw: string): Array<Record<string, unknown>> {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const parsed = JSON.parse(cleaned) as unknown;
  if (!Array.isArray(parsed)) throw new Error("Packing-list OCR did not return a line array");
  return parsed.filter((value): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value));
}

function numberOrNull(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function statusPresentation(status: MatchStatus) {
  switch (status) {
    case "matched": return { label: "MATCHED", color: theme.statusOk };
    case "unknown_part": return { label: "UNKNOWN PART", color: "#ef4444" };
    case "ambiguous_part": return { label: "AMBIGUOUS", color: "#ef4444" };
    case "invalid_part_number": return { label: "INVALID PART", color: "#f59e0b" };
    case "invalid_quantity": return { label: "INVALID QTY", color: "#f59e0b" };
    default: return { label: "REVIEW REQUIRED", color: "#f59e0b" };
  }
}

export function IncomingStockSecure() {
  const data = useConvexData();
  const ocrPackingList = useAction(api.aiGateway.ocrPackingList);
  const reviewPackingListDraft = useAction(api.incomingStockActions.reviewPackingListDraft);
  const commitConfirmedReceiveLine = useAction(api.incomingStockActions.commitConfirmedReceiveLine);
  const getIncomingReceiptRecovery = useAction(api.incomingStockActions.getIncomingReceiptRecovery);
  const acknowledgeIncomingReceiptAttempt = useAction(api.incomingStockActions.acknowledgeIncomingReceiptAttempt);
  const reserveIncomingManualReceiptReview = useAction(api.incomingStockActions.reserveIncomingManualReceiptReview);
  const resolveIncomingReceiptAttempt = useAction(api.incomingStockActions.resolveIncomingReceiptAttempt);

  const cameraInput = useRef<HTMLInputElement>(null);
  const uploadInput = useRef<HTMLInputElement>(null);

  const [documentRef, setDocumentRef] = useState("");
  const [lines, setLines] = useState<IncomingLine[]>([]);
  const [review, setReview] = useState<ReviewResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [commitBusy, setCommitBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const commitGuard = useRef(false);
  const reviewGuard = useRef(false);
  const attemptedRequests = useRef(new Map<string, ConfirmedReceiveRequest>());

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const recovered = await getIncomingReceiptRecovery({}) as unknown as RecoveryAttempt[];
        if (cancelled || recovered.length === 0) return;
        const restored: IncomingLine[] = [];
        let firstRef = "";
        for (const attempt of recovered) {
          if (!attempt?.attemptId || !attempt.documentRef || !Number.isSafeInteger(attempt.sourceLineNo)) continue;
          firstRef ||= attempt.documentRef;
          const lineId = `recovery-${attempt.attemptId}`;
          const request: ConfirmedReceiveRequest = Object.freeze({
            partNumber: attempt.partNumber,
            qty: attempt.qty,
            confirmationId: attempt.correlationId || attempt.attemptId,
            documentRef: attempt.documentRef,
            sourcePage: attempt.sourcePage ?? undefined,
            sourceLineNo: attempt.sourceLineNo,
          });
          let acknowledged = false;
          if (attempt.state === "accepted") {
            try {
              await acknowledgeIncomingReceiptAttempt({ attemptId: attempt.attemptId });
              acknowledged = true;
            } catch {
              // Keep it recovery-bound if acknowledgement cannot be persisted.
            }
          }
          if (!acknowledged) attemptedRequests.current.set(lineId, request);
          restored.push({
            id: lineId,
            confirmationId: attempt.correlationId || attempt.attemptId,
            reviewedDocumentRef: attempt.documentRef,
            sourceLineNo: attempt.sourceLineNo,
            partNumber: attempt.partNumber,
            description: "Recovered persisted receipt attempt",
            qty: attempt.qty,
            orderedQty: null,
            confidence: null,
            matchStatus: attempt.state === "conflict" ? "needs_review" : "matched",
            resolvedPartNumber: attempt.partNumber,
            stockDescription: null,
            qtyOnHand: null,
            selected: !["accepted", "conflict"].includes(attempt.state),
            commitStatus: attempt.state === "accepted" ? "received" : attempt.state === "conflict" ? "failed" : "idle",
            message: attempt.state === "accepted"
              ? "Recovered accepted receipt from the server; no second inventory movement was made."
              : attempt.state === "conflict"
                ? "Persisted receipt conflict requires review before any new RECEIVE."
                : "Recovered persisted receipt attempt. Retry this exact line to reconcile the authoritative result.",
            sourcePage: attempt.sourcePage,
            deterministicIdentity: attempt.correlationId,
            attemptId: attempt.attemptId,
            attemptRevision: attempt.revision,
          });
        }
        if (cancelled || restored.length === 0) return;
        setDocumentRef((current) => current || firstRef);
        setLines((current) => current.length ? current : restored);
        setStatus("Recovered an unfinished Incoming Stock receipt from the server. Reconcile these exact physical lines before starting a different receipt.");
      } catch {
        if (!cancelled) setStatus("Receipt recovery is temporarily unavailable. Do not retry an uncertain receipt under a different reference.");
      }
    })();
    return () => { cancelled = true; };
  }, [acknowledgeIncomingReceiptAttempt, getIncomingReceiptRecovery]);

  const changeDocumentRef = (value: string) => {
    if (commitGuard.current || reviewGuard.current) return;
    const next = value.slice(0, 200);
    const hasUnresolvedPersistedAttempt = lines.some((line) => line.attemptId && line.commitStatus !== "received");
    if ((attemptedRequests.current.size || hasUnresolvedPersistedAttempt) && receiptReference(next) !== receiptReference(documentRef)) {
      setStatus("This receipt has a persisted review or attempt. Resolve it under its original reference before starting a different receipt.");
      return;
    }
    if (receiptReference(next) !== receiptReference(documentRef)) {
      setLines(previous => previous.map(line => ({...line, selected: false, matchStatus: "needs_review", message: null})));
      setReview(null);
      if (lines.length) setStatus("Reference changed. Re-review the existing lines before confirming this receipt.");
    }
    setDocumentRef(next);
  };
  const [manualPart, setManualPart] = useState("");
  const [manualQty, setManualQty] = useState("1");
  const [manualDescription, setManualDescription] = useState("");

  const partList = useMemo(() => data.parts.map((part) => part.partNumber), [data.parts]);
  const selectedMatched = useMemo(
    () => lines.filter((line) => line.selected && line.matchStatus === "matched" && line.commitStatus !== "received"),
    [lines],
  );
  const receivedCount = lines.filter((line) => line.commitStatus === "received").length;
  const unresolvedCount = lines.filter((line) => line.matchStatus !== "matched").length;

const mergeReview = (
  source: Array<Record<string, unknown>>,
  review: ReviewResponse,
  existing?: IncomingLine,
  reviewedDocumentRef = "",
): IncomingLine[] => review.lines.map((row, index) => {
    const raw = source[index] ?? {};
    const orderedQty = numberOrNull(raw.orderedQuantity ?? raw.ordered_quantity ?? raw.orderedQty ?? raw.ordered_qty);
    const match = row.matchStatus === "matched";
    return {
      id: existing?.id ?? makeId("incoming-line"),
      // confirmationId is now a presentation key only; deterministic identity comes from server
      confirmationId: row.deterministicIdentity ?? existing?.confirmationId ?? makeId("confirm"),
      reviewedDocumentRef,
      sourceLineNo: row.sourceLineNo || index + 1,
      partNumber: row.resolvedPartNumber ?? row.partNumberOcr,
      description: row.stockDescription ?? row.descriptionOcr,
      qty: row.qtyOcr ?? 0,
      orderedQty,
      confidence: row.confidence,
      matchStatus: row.matchStatus,
      resolvedPartNumber: row.resolvedPartNumber,
      stockDescription: row.stockDescription,
      qtyOnHand: row.qtyOnHand,
      selected: match,
      commitStatus: "idle",
      message: null,
      sourcePage: row.sourcePage,
      deterministicIdentity: row.deterministicIdentity,
    };
  });

  const serverReview = async (
    draft: Array<Record<string, unknown>>,
    existing?: IncomingLine,
    documentRefOverride?: string,
  ) => {
    const effectiveDocumentRef = (documentRefOverride ?? documentRef).trim();
    const review = await reviewPackingListDraft({
      ocrJson: JSON.stringify(draft),
      documentRef: effectiveDocumentRef || undefined,
    }) as unknown as ReviewResponse;
    if (!existing) {
      setReview(review);
    }
    return mergeReview(draft, review, existing, effectiveDocumentRef);
  };

  const scanImage = async (file: File) => {
    if (commitGuard.current || reviewGuard.current) return;
    reviewGuard.current = true;
    setBusy(true);
    setStatus("Reading packing list…");
    try {
      const imageBase64 = await imageToBase64(file);
      const raw = await ocrPackingList({
        imageBase64,
        partList,
        prompt: "Extract every physical inventory line from this Incoming Stock packing list. Preserve repeated part lines. Use SHIP QTY when ordered and shipped quantities both exist. Do not interpret line numbers, page numbers, GTIN, tracking numbers, or weights as receive quantities.",
      });
      const draft = parseOcrArray(raw);
      if (draft.length === 0) throw new Error("No inventory lines were found. Try a clearer packing-list photo.");

      const firstRef = draft.find((row) => typeof row.documentRef === "string" && row.documentRef.trim())?.documentRef;
      const firstPo = draft.find((row) => typeof row.poNumber === "string" && row.poNumber.trim())?.poNumber;
      const effectiveRef = documentRef.trim()
        || (typeof firstRef === "string" ? firstRef.trim() : "")
        || (typeof firstPo === "string" ? firstPo.trim() : "");
      const boundedEffectiveRef = effectiveRef.slice(0, 200);
      if (!documentRef && boundedEffectiveRef) setDocumentRef(boundedEffectiveRef);

      const reviewed = await serverReview(draft, undefined, boundedEffectiveRef);
      setLines((previous) => [...previous, ...reviewed]);
      const matched = reviewed.filter((line) => line.matchStatus === "matched").length;
      setStatus(`Reviewed ${reviewed.length} line${reviewed.length === 1 ? "" : "s"}: ${matched} exact part-number match${matched === 1 ? "" : "es"}. Human confirmation is required before inventory changes.`);
    } catch (error) {
      setStatus(`Error: ${safeOcrError(error)}`);
    } finally {
      reviewGuard.current = false;
      setBusy(false);
    }
  };

  const onImage = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void scanImage(file);
  };

  const addManual = async () => {
    if (commitGuard.current || reviewGuard.current) return;
    const qty = Number(manualQty);
    if (!manualPart.trim() || !Number.isInteger(qty) || qty <= 0) {
      setStatus("Enter an exact part number and a positive whole-number quantity.");
      return;
    }
    if (!documentRef.trim()) {
      setStatus("Enter the receipt reference before adding a manual line so its physical identity can be recovered after reload.");
      return;
    }
    reviewGuard.current = true;
    setBusy(true);
    try {
      const reservation = await reserveIncomingManualReceiptReview({
        documentRef: documentRef.trim(),
        partNumber: manualPart.trim(),
        qty,
      }) as unknown as {
        attemptId: string; revision: number; documentRef: string; sourcePage: string;
        sourceLineNo: number; partNumber: string; canonicalPartNumber: string;
        correlationId: string; stockDescription?: string | null; qtyOnHand?: number | null;
      };
      const line: IncomingLine = {
        id: `recovery-${reservation.attemptId}`,
        confirmationId: reservation.correlationId,
        reviewedDocumentRef: reservation.documentRef,
        sourceLineNo: reservation.sourceLineNo,
        partNumber: reservation.partNumber,
        description: manualDescription.trim() || reservation.stockDescription || "",
        qty,
        orderedQty: null,
        confidence: null,
        matchStatus: "matched",
        resolvedPartNumber: reservation.partNumber,
        stockDescription: reservation.stockDescription ?? null,
        qtyOnHand: reservation.qtyOnHand ?? null,
        selected: true,
        commitStatus: "idle",
        message: "Manual physical line reserved on the server. Human confirmation is still required before inventory changes.",
        sourcePage: "MANUAL",
        deterministicIdentity: reservation.correlationId,
        attemptId: reservation.attemptId,
        attemptRevision: reservation.revision,
      };
      setLines((previous) => [...previous, line]);
      setManualPart("");
      setManualQty("1");
      setManualDescription("");
      setStatus("Manual line identity was atomically reserved and matched by canonical part number. Confirm it before receiving.");
    } catch (error) {
      setStatus(`Error: ${safeError(error)}`);
    } finally {
      reviewGuard.current = false;
      setBusy(false);
    }
  };

  const resolvePersistedLine = async (line: IncomingLine) => {
    if (commitGuard.current || reviewGuard.current || !line.attemptId || !line.attemptRevision) return;
    reviewGuard.current = true;
    setBusy(true);
    try {
      const resolved = await resolveIncomingReceiptAttempt({
        attemptId: line.attemptId,
        expectedRevision: line.attemptRevision,
      }) as unknown as { state?: string };
      if (resolved.state !== "abandoned") throw new Error("Receipt conflict was not resolved");
      attemptedRequests.current.delete(line.id);
      setLines((previous) => previous.filter((candidate) => candidate.id !== line.id));
      setStatus("Persisted receipt review was safely abandoned with no inventory movement. You may now review a corrected physical line.");
    } catch (error) {
      setLines((previous) => previous.map((candidate) => candidate.id === line.id
        ? { ...candidate, commitStatus: "failed", message: safeError(error) }
        : candidate));
      setStatus(`Error: ${safeError(error)}`);
    } finally {
      reviewGuard.current = false;
      setBusy(false);
    }
  };

  const updateLine = (id: string, patch: Partial<IncomingLine>) => {
    if (commitGuard.current || reviewGuard.current || attemptedRequests.current.has(id)) return;
    setLines((previous) => previous.map((line) => line.id === id
      ? { ...line, ...patch, matchStatus: "needs_review", selected: false, commitStatus: "idle", message: null }
      : line));
  };

  const reReviewLine = async (line: IncomingLine) => {
    if (commitGuard.current || reviewGuard.current || attemptedRequests.current.has(line.id)) return;
    reviewGuard.current = true;
    setBusy(true);
    try {
      const draft = [{
        partNumber: line.partNumber,
        description: line.description,
        qty: line.qty,
        page: line.sourcePage,
        lineNo: line.sourceLineNo,
      }];
      const [reviewed] = await serverReview(draft, line);
      setLines((previous) => previous.map((candidate) => candidate.id === line.id ? reviewed : candidate));
      setStatus(reviewed.matchStatus === "matched"
        ? `${reviewed.resolvedPartNumber} matched exactly. Confirm it before receiving.`
        : `${line.partNumber || "Line"} did not resolve to exactly one inventory part.`);
    } catch (error) {
      setStatus(`Error: ${safeError(error)}`);
    } finally {
      reviewGuard.current = false;
      setBusy(false);
    }
  };

  const commitSelected = async () => {
    if (commitGuard.current || reviewGuard.current) return;
    if (selectedMatched.length === 0) {
      setStatus("Select at least one matched line to confirm receiving.");
      return;
    }
    if (!documentRef.trim() || selectedMatched.some(line => !attemptedRequests.current.has(line.id) && receiptReference(line.reviewedDocumentRef) !== receiptReference(documentRef))) {
      setStatus("Enter the receipt reference and re-review the lines before confirmation. An attempted line cannot be rebound to another receipt.");
      return;
    }
    commitGuard.current = true;
    setCommitBusy(true);
    setStatus("Applying confirmed RECEIVE movements…");
    let succeeded = 0;
    let failed = 0;

    for (const line of selectedMatched) {
      setLines((previous) => previous.map((candidate) => candidate.id === line.id
        ? { ...candidate, commitStatus: "committing", message: null }
        : candidate));
      try {
        const request = attemptedRequests.current.get(line.id) ?? Object.freeze({
          partNumber: line.resolvedPartNumber ?? line.partNumber,
          qty: line.qty,
          confirmationId: line.confirmationId,
          documentRef: line.reviewedDocumentRef,
          sourcePage: line.sourcePage ?? undefined,
          sourceLineNo: line.sourceLineNo,
        });
        attemptedRequests.current.set(line.id, request);
        const result = await commitConfirmedReceiveLine({...request}) as unknown as {
          receipt?: Record<string, unknown>; correlationId?: string; attemptId?: string;
        };
        const duplicate = Boolean(result.receipt?.duplicate);
        let acknowledgementPending = false;
        if (result.attemptId) {
          try {
            await acknowledgeIncomingReceiptAttempt({ attemptId: result.attemptId });
            attemptedRequests.current.delete(line.id);
          } catch {
            acknowledgementPending = true;
          }
        }
        setLines((previous) => previous.map((candidate) => candidate.id === line.id
          ? {
              ...candidate,
              selected: false,
              commitStatus: "received",
              attemptId: result.attemptId ?? candidate.attemptId,
              message: acknowledgementPending
                ? "Received atomically. Server acknowledgement is still pending, so this exact receipt will remain recoverable after reload."
                : duplicate
                  ? "Already received earlier — idempotent retry made no second movement."
                  : "Received atomically and staged through the inventory transition path.",
            }
          : candidate));
        succeeded += 1;
      } catch (error) {
        setLines((previous) => previous.map((candidate) => candidate.id === line.id
          ? { ...candidate, commitStatus: "failed", message: safeError(error) }
          : candidate));
        failed += 1;
      }
    }

    await data.refresh().catch(() => undefined);
    setStatus(`Receive complete: ${succeeded} accepted, ${failed} failed. Accepted lines are idempotent and inventory is server-authoritative.`);
    commitGuard.current = false;
    setCommitBusy(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-black" style={{ color: theme.textPrimary }}>Incoming Stock</h2>
          <p className="mt-0.5 text-sm" style={{ color: theme.textSecondary }}>
            Packing-list photo → server OCR → exact part-number review → human-confirmed atomic RECEIVE
          </p>
        </div>
        <div className="rounded-xl px-3 py-2 text-[11px]" style={{ backgroundColor: theme.cardBg, border: `1px solid ${theme.cardBorder}`, color: theme.textSecondary }}>
          Operator identity and authorization are resolved by the server. Descriptions never determine part identity.
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <WebCard className="p-4">
          <div className="text-[10px] font-bold tracking-wider" style={{ color: theme.textMuted }}>REVIEW LINES</div>
          <div className="mt-1 text-2xl font-black" style={{ color: theme.textPrimary }}>{lines.length}</div>
        </WebCard>
        <WebCard className="p-4">
          <div className="text-[10px] font-bold tracking-wider" style={{ color: theme.textMuted }}>NEEDS ATTENTION</div>
          <div className="mt-1 text-2xl font-black" style={{ color: unresolvedCount ? "#f59e0b" : theme.statusOk }}>{unresolvedCount}</div>
        </WebCard>
        <WebCard className="p-4">
          <div className="text-[10px] font-bold tracking-wider" style={{ color: theme.textMuted }}>RECEIVED</div>
          <div className="mt-1 text-2xl font-black" style={{ color: theme.statusOk }}>{receivedCount}</div>
        </WebCard>
      </div>

      <WebCard className="p-4">
        <div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-end">
          <label className="block">
            <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider" style={{ color: theme.textMuted }}>Document / Delivery / PO reference</span>
            <input
              value={documentRef}
              disabled={busy || commitBusy}
              onChange={(event) => changeDocumentRef(event.target.value)}
              placeholder="Required for deterministic receipt identity"
              className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
              style={{ backgroundColor: theme.inputBg, border: `1px solid ${theme.cardBorder}`, color: theme.textPrimary }}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button disabled={busy || commitBusy} onClick={() => cameraInput.current?.click()} className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold text-white disabled:opacity-50" style={{ backgroundColor: theme.accentBlue }}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />} Camera
            </button>
            <button disabled={busy || commitBusy} onClick={() => uploadInput.current?.click()} className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold disabled:opacity-50" style={{ backgroundColor: theme.inputBg, border: `1px solid ${theme.cardBorder}`, color: theme.textPrimary }}>
              <Upload className="h-4 w-4" /> Upload Image
            </button>
          </div>
        </div>
        <input ref={cameraInput} className="hidden" type="file" accept="image/*" capture="environment" onChange={onImage} />
        <input ref={uploadInput} className="hidden" type="file" accept="image/*" onChange={onImage} />
        {status && <div className="mt-3 rounded-lg px-3 py-2 text-xs" style={{ backgroundColor: theme.inputBg, color: status.startsWith("Error:") ? "#ef4444" : theme.textSecondary }}>{status}</div>}
      </WebCard>

      {/* Aggregate summary by canonical part number (review-only, does not collapse commit identities) */}
      {review?.aggregateSummary && review.aggregateSummary.length > 0 && (
        <WebCard className="p-4">
          <div className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: theme.textMuted }}>AGGREGATE SUMMARY BY CANONICAL PART NUMBER (REVIEW ONLY)</div>
          <div className="grid gap-2 md:grid-cols-4">
            {review.aggregateSummary.map((agg, idx) => (
              <div key={idx} className="rounded-lg px-3 py-2 text-xs" style={{ backgroundColor: theme.cardBg, border: `1px solid ${theme.cardBorder}` }}>
                <div className="font-bold" style={{ color: theme.accentBlue }}>{agg.canonicalPartNumber}</div>
                <div style={{ color: theme.textSecondary }}>Lines: {agg.lineCount} | Matched: {agg.matchedCount}</div>
                <div style={{ color: theme.textPrimary }}>Total Qty: {agg.totalQty}</div>
              </div>
            ))}
          </div>
        </WebCard>
      )}

      <WebCard className="p-4">
        <div className="mb-3 flex items-center gap-2">
          <Plus className="h-4 w-4" style={{ color: theme.accentBlue }} />
          <span className="text-sm font-bold" style={{ color: theme.textPrimary }}>Manual exact part entry</span>
        </div>
        <div className="grid gap-2 md:grid-cols-[180px_90px_1fr_auto]">
          <input value={manualPart} onChange={(event) => setManualPart(event.target.value)} placeholder="Part number" className="rounded-lg px-3 py-2 text-sm outline-none" style={{ backgroundColor: theme.inputBg, border: `1px solid ${theme.cardBorder}`, color: theme.textPrimary }} />
          <input value={manualQty} onChange={(event) => setManualQty(event.target.value)} inputMode="numeric" placeholder="Qty" className="rounded-lg px-3 py-2 text-sm outline-none" style={{ backgroundColor: theme.inputBg, border: `1px solid ${theme.cardBorder}`, color: theme.textPrimary }} />
          <input value={manualDescription} onChange={(event) => setManualDescription(event.target.value)} placeholder="Description (informational only)" className="rounded-lg px-3 py-2 text-sm outline-none" style={{ backgroundColor: theme.inputBg, border: `1px solid ${theme.cardBorder}`, color: theme.textPrimary }} />
          <button disabled={busy || commitBusy} onClick={() => void addManual()} className="rounded-lg px-4 py-2 text-xs font-bold disabled:opacity-50" style={{ backgroundColor: theme.accentBlue, color: "white" }}>Review</button>
        </div>
      </WebCard>

      <WebCard className="overflow-hidden">
        <div className="max-h-[58vh] overflow-auto overscroll-contain" tabIndex={0} aria-label="Incoming Stock human confirmation table">
          <div className="min-w-[1180px]">
            <div className="sticky top-0 z-10 grid grid-cols-[42px_58px_80px_60px_150px_85px_1fr_110px_110px_130px_110px] items-center gap-2 border-b px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider" style={{ backgroundColor: "#0f172a", borderColor: theme.cardBorder, color: theme.textMuted }}>
              <span />
              <span>Line</span>
              <span>Page</span>
              <span>SrcLine</span>
              <span>Part #</span>
              <span>Ship Qty</span>
              <span>Description</span>
              <span>QOH</span>
              <span>Confidence</span>
              <span>Match</span>
              <span>Action</span>
            </div>
            {lines.length === 0 ? (
              <div className="py-12 text-center">
                <FileImage className="mx-auto mb-2 h-7 w-7" style={{ color: theme.textMuted }} />
                <div className="text-sm font-bold" style={{ color: theme.textPrimary }}>No packing-list lines yet</div>
                <div className="mt-1 text-xs" style={{ color: theme.textSecondary }}>Take a photo or upload an image. Nothing changes inventory until you confirm matched lines.</div>
              </div>
            ) : lines.map((line) => {
              const presentation = statusPresentation(line.matchStatus);
              const editable = !busy && !commitBusy && !attemptedRequests.current.has(line.id) && !line.attemptId && line.commitStatus !== "received";
              return (
                <div key={line.id} className="grid grid-cols-[42px_58px_80px_60px_150px_85px_1fr_110px_110px_130px_110px] items-center gap-2 border-b px-4 py-2.5" style={{ borderColor: theme.cardBorder, backgroundColor: line.selected ? `${theme.accentBlue}0d` : undefined }}>
                  <button
                    type="button"
                    disabled={busy || commitBusy || line.matchStatus !== "matched" || line.commitStatus === "received"}
                    onClick={() => { if (commitGuard.current || reviewGuard.current) return; setLines((previous) => previous.map((candidate) => candidate.id === line.id ? { ...candidate, selected: !candidate.selected } : candidate)); }}
                    aria-label={`Select line ${line.sourceLineNo} for receiving`}
                    className="flex h-5 w-5 items-center justify-center rounded border-2 disabled:opacity-30"
                    style={{ borderColor: line.selected ? theme.accentBlue : theme.cardBorder, backgroundColor: line.selected ? theme.accentBlue : "transparent" }}
                  >
                    {line.selected && <Check className="h-3 w-3 text-white" />}
                  </button>
                  <span className="text-xs" style={{ color: theme.textSecondary }}>{line.sourceLineNo}</span>
                  <span className="text-xs font-mono" style={{ color: theme.textSecondary }}>{line.sourcePage || "—"}</span>
                  <span className="text-xs font-mono" style={{ color: theme.textSecondary }}>{line.sourceLineNo}</span>
                  <input disabled={!editable} value={line.partNumber} onChange={(event) => updateLine(line.id, { partNumber: event.target.value })} className="w-full rounded px-2 py-1.5 text-xs font-bold outline-none disabled:opacity-80" style={{ backgroundColor: theme.inputBg, border: `1px solid ${theme.cardBorder}`, color: theme.accentBlue }} />
                  <input disabled={!editable} value={String(line.qty)} inputMode="numeric" onChange={(event) => updateLine(line.id, { qty: Number(event.target.value) })} className="w-full rounded px-2 py-1.5 text-xs font-bold outline-none disabled:opacity-80" style={{ backgroundColor: theme.inputBg, border: `1px solid ${theme.cardBorder}`, color: theme.textPrimary }} />
                  <input disabled={!editable} value={line.description} onChange={(event) => updateLine(line.id, { description: event.target.value })} className="w-full rounded px-2 py-1.5 text-xs outline-none disabled:opacity-80" style={{ backgroundColor: theme.inputBg, border: `1px solid ${theme.cardBorder}`, color: theme.textSecondary }} />
                  <span className="text-xs font-bold" style={{ color: theme.textPrimary }}>{line.qtyOnHand ?? "—"}</span>
                  <span className="text-xs" style={{ color: theme.textSecondary }}>{line.confidence == null ? "—" : `${Math.round(line.confidence * 100)}%`}</span>
                  <span className="text-[10px] font-bold" style={{ color: presentation.color }}>{line.commitStatus === "received" ? "RECEIVED" : presentation.label}</span>
                  <div className="flex items-center gap-1">
                    {line.matchStatus === "needs_review" && editable && (
                      <button onClick={() => void reReviewLine(line)} disabled={busy} className="rounded p-1.5" title="Re-run server exact-match review" aria-label={`Review corrected line ${line.sourceLineNo}`}><RefreshCw className="h-3.5 w-3.5" style={{ color: theme.accentBlue }} /></button>
                    )}
                    {line.attemptId && line.commitStatus !== "received" ? (
                      <button disabled={busy || commitBusy} onClick={() => void resolvePersistedLine(line)} className="rounded p-1.5" title="Resolve and abandon this persisted review only when no inventory movement exists" aria-label={`Resolve persisted line ${line.sourceLineNo}`}><Trash2 className="h-3.5 w-3.5" style={{ color: "#ef4444" }} /></button>
                    ) : line.commitStatus !== "received" ? (
                      <button disabled={!editable} onClick={() => { if (commitGuard.current || reviewGuard.current || attemptedRequests.current.has(line.id)) return; setLines((previous) => previous.filter((candidate) => candidate.id !== line.id)); }} className="rounded p-1.5" title="Remove draft line" aria-label={`Remove draft line ${line.sourceLineNo}`}><Trash2 className="h-3.5 w-3.5" style={{ color: "#ef4444" }} /></button>
                    ) : null}
                    {line.commitStatus === "committing" && <Loader2 className="h-4 w-4 animate-spin" style={{ color: theme.accentBlue }} />}
                  </div>
                  {line.orderedQty != null && line.orderedQty !== line.qty && (
                    <div className="col-span-11 text-[10px]" style={{ color: "#f59e0b" }}>Ordered {line.orderedQty}, shipped {line.qty}. RECEIVE uses shipped quantity.</div>
                  )}
                  {line.message && <div className="col-span-11 text-[10px]" style={{ color: line.commitStatus === "failed" ? "#ef4444" : theme.textSecondary }}>{line.message}</div>}
                </div>
              );
            })}
          </div>
        </div>
      </WebCard>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3" style={{ backgroundColor: theme.cardBg, border: `1px solid ${theme.cardBorder}` }}>
        <div className="text-xs" style={{ color: theme.textSecondary }}>
          {selectedMatched.length} matched line{selectedMatched.length === 1 ? "" : "s"} selected. Confirmation creates idempotent atomic RECEIVE transactions; retries cannot double-receive the same confirmed line.
        </div>
        <button disabled={commitBusy || busy || selectedMatched.length === 0} onClick={() => void commitSelected()} className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-xs font-black text-white disabled:opacity-40" style={{ backgroundColor: theme.statusOk }}>
          {commitBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          Confirm & Receive ({selectedMatched.length})
        </button>
      </div>
    </div>
  );
}
