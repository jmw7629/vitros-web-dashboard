import { useMemo, useRef, useState } from "react";
import { useAction } from "convex/react";
import { Check, FileText, Loader2, Upload, X } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { WebCard, theme } from "../../components/vitros/SharedComponents";
import { useConvexData } from "../../hooks/useConvexData";
import { IncomingStockSecure } from "./IncomingStockSecure";

type MatchStatus =
  | "matched"
  | "unknown_part"
  | "ambiguous_part"
  | "invalid_part_number"
  | "invalid_quantity";

type CommitStatus = "idle" | "committing" | "received" | "failed";

interface ReviewLine {
  lineNo: number;
  partNumberOcr: string;
  descriptionOcr: string;
  qtyOcr: number | null;
  confidence: number | null;
  matchStatus: MatchStatus;
  resolvedPartNumber: string | null;
  stockDescription: string | null;
  qtyOnHand: number | null;
}

interface ReviewResponse {
  requiresHumanConfirmation: boolean;
  identityRule: string;
  descriptionUsedForIdentity: boolean;
  quantityRule: string;
  lines: ReviewLine[];
}

interface PdfReviewLine extends ReviewLine {
  id: string;
  confirmationId: string;
  orderedQty: number | null;
  selected: boolean;
  commitStatus: CommitStatus;
  message: string | null;
}

const MAX_PDF_BYTES = 8 * 1024 * 1024;

function makeId(prefix: string) {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`;
}

function numberOrNull(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function parseOcrArray(raw: string): Array<Record<string, unknown>> {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const parsed = JSON.parse(cleaned) as unknown;
  if (!Array.isArray(parsed)) throw new Error("Packing-list PDF OCR did not return a line array");
  return parsed.filter((value): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value));
}

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : "Operation failed";
  if (/ambiguous/i.test(message)) return "Part number is ambiguous in Stock Summary. Nothing was received.";
  if (/not present|not found/i.test(message)) return "Part number is not present in Stock Summary. Nothing was received.";
  if (/quantity/i.test(message)) return "Receive quantity must be a positive whole number.";
  if (/capability|authenticated|unauthorized/i.test(message)) return "Your authenticated session is not authorized for Incoming Stock receiving.";
  return message.slice(0, 220);
}

async function pdfToBase64(file: File): Promise<string> {
  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  if (!isPdf) throw new Error("Select a PDF packing list");
  if (file.size <= 0) throw new Error("The selected PDF is empty");
  if (file.size > MAX_PDF_BYTES) throw new Error("PDF is too large. Maximum size is 8 MB.");

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Unable to read PDF"));
    reader.readAsDataURL(file);
  });
  const comma = dataUrl.indexOf(",");
  if (comma < 0) throw new Error("Unable to read PDF");
  return dataUrl.slice(comma + 1);
}

function statusLabel(status: MatchStatus) {
  switch (status) {
    case "matched": return { label: "MATCHED", color: theme.statusOk };
    case "unknown_part": return { label: "UNKNOWN PART", color: "#ef4444" };
    case "ambiguous_part": return { label: "AMBIGUOUS", color: "#ef4444" };
    case "invalid_part_number": return { label: "INVALID PART", color: "#f59e0b" };
    case "invalid_quantity": return { label: "INVALID QTY", color: "#f59e0b" };
  }
}

function PdfIntakeModal({ onClose }: { onClose: () => void }) {
  const data = useConvexData();
  const ocrPackingListPdf = useAction(api.incomingStockPdfOcr.ocrPackingListPdf);
  const reviewPackingListDraft = useAction(api.incomingStockActions.reviewPackingListDraft);
  const commitConfirmedReceiveLine = useAction(api.incomingStockActions.commitConfirmedReceiveLine);
  const fileInput = useRef<HTMLInputElement>(null);

  const [documentRef, setDocumentRef] = useState("");
  const [lines, setLines] = useState<PdfReviewLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [commitBusy, setCommitBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const partList = useMemo(() => data.parts.map((part) => part.partNumber), [data.parts]);
  const selected = useMemo(
    () => lines.filter((line) => line.selected && line.matchStatus === "matched" && line.commitStatus !== "received"),
    [lines],
  );

  const onPdf = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setBusy(true);
    setStatus("Reading every page of the packing-list PDF…");
    try {
      const pdfBase64 = await pdfToBase64(file);
      const raw = await ocrPackingListPdf({
        pdfBase64,
        filename: file.name.slice(0, 120),
        partList,
        prompt: "Extract every physical inventory line from every page of this Incoming Stock packing list PDF. Preserve repeated part lines. Use SHIP QTY when ordered and shipped quantities both exist. Do not interpret line numbers, page numbers, GTIN, tracking numbers, or weights as receive quantities.",
      });
      const draft = parseOcrArray(raw);
      if (draft.length === 0) throw new Error("No inventory lines were found in this PDF");

      const extractedRef = draft.find((row) => typeof row.documentRef === "string" && row.documentRef.trim())?.documentRef;
      const extractedPo = draft.find((row) => typeof row.poNumber === "string" && row.poNumber.trim())?.poNumber;
      const effectiveRef = documentRef.trim()
        || (typeof extractedRef === "string" ? extractedRef.trim() : "")
        || (typeof extractedPo === "string" ? extractedPo.trim() : "");
      if (!documentRef && effectiveRef) setDocumentRef(effectiveRef.slice(0, 200));

      const review = await reviewPackingListDraft({
        ocrJson: JSON.stringify(draft),
        documentRef: effectiveRef ? effectiveRef.slice(0, 200) : undefined,
      }) as unknown as ReviewResponse;
      if (!review.requiresHumanConfirmation || review.descriptionUsedForIdentity || review.identityRule !== "canonical_part_number_only") {
        throw new Error("Server review returned an unsafe identity contract");
      }

      const reviewed: PdfReviewLine[] = review.lines.map((line, index) => {
        const source = draft[index] ?? {};
        return {
          ...line,
          id: makeId("pdf-line"),
          confirmationId: makeId("pdf-confirm"),
          orderedQty: numberOrNull(source.orderedQuantity ?? source.ordered_quantity ?? source.orderedQty ?? source.ordered_qty),
          selected: line.matchStatus === "matched",
          commitStatus: "idle",
          message: null,
        };
      });
      setLines(reviewed);
      const matched = reviewed.filter((line) => line.matchStatus === "matched").length;
      setStatus(`PDF reviewed: ${reviewed.length} physical line${reviewed.length === 1 ? "" : "s"}, ${matched} exact inventory match${matched === 1 ? "" : "es"}. Nothing changes inventory until you confirm.`);
    } catch (error) {
      setLines([]);
      setStatus(`Error: ${safeError(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const commitSelected = async () => {
    if (selected.length === 0) {
      setStatus("Select at least one matched PDF line to confirm receiving.");
      return;
    }
    setCommitBusy(true);
    setStatus("Applying human-confirmed PDF RECEIVE movements…");
    let succeeded = 0;
    let failed = 0;

    for (const line of selected) {
      setLines((previous) => previous.map((candidate) => candidate.id === line.id
        ? { ...candidate, commitStatus: "committing", message: null }
        : candidate));
      try {
        const result = await commitConfirmedReceiveLine({
          partNumber: line.resolvedPartNumber ?? line.partNumberOcr,
          qty: line.qtyOcr ?? 0,
          confirmationId: line.confirmationId,
          documentRef: documentRef.trim() || undefined,
          lineNo: line.lineNo,
        }) as unknown as { receipt?: Record<string, unknown> };
        const duplicate = Boolean(result.receipt?.duplicate);
        setLines((previous) => previous.map((candidate) => candidate.id === line.id
          ? {
              ...candidate,
              selected: false,
              commitStatus: "received",
              message: duplicate
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
    setStatus(`PDF receive complete: ${succeeded} accepted, ${failed} failed. Accepted lines are idempotent and server-authoritative.`);
    setCommitBusy(false);
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-3" role="dialog" aria-modal="true" aria-label="Incoming Stock PDF intake">
      <WebCard className="flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden">
        <div className="flex items-start justify-between gap-3 border-b px-4 py-3" style={{ borderColor: theme.cardBorder }}>
          <div>
            <div className="flex items-center gap-2">
              <FileText className="h-5 w-5" style={{ color: theme.accentBlue }} />
              <h3 className="text-base font-black" style={{ color: theme.textPrimary }}>PDF Packing List Intake</h3>
            </div>
            <p className="mt-1 text-xs" style={{ color: theme.textSecondary }}>
              Server OCR → exact canonical part match → human confirmation → idempotent atomic RECEIVE
            </p>
          </div>
          <button disabled={busy || commitBusy} onClick={onClose} className="rounded-lg p-2 disabled:opacity-40" aria-label="Close PDF intake">
            <X className="h-5 w-5" style={{ color: theme.textMuted }} />
          </button>
        </div>

        <div className="grid gap-3 border-b p-4 md:grid-cols-[1fr_auto] md:items-end" style={{ borderColor: theme.cardBorder }}>
          <label>
            <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider" style={{ color: theme.textMuted }}>Document / Delivery / PO reference</span>
            <input
              value={documentRef}
              onChange={(event) => setDocumentRef(event.target.value.slice(0, 200))}
              placeholder="Optional reference used for traceability"
              className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
              style={{ backgroundColor: theme.inputBg, border: `1px solid ${theme.cardBorder}`, color: theme.textPrimary }}
            />
          </label>
          <button disabled={busy || commitBusy} onClick={() => fileInput.current?.click()} className="flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold text-white disabled:opacity-50" style={{ backgroundColor: theme.accentBlue }}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {busy ? "Reading PDF…" : "Choose PDF"}
          </button>
          <input ref={fileInput} className="hidden" type="file" accept="application/pdf,.pdf" onChange={(event) => void onPdf(event)} />
          {status && (
            <div className="md:col-span-2 rounded-lg px-3 py-2 text-xs" style={{ backgroundColor: theme.inputBg, color: status.startsWith("Error:") ? "#ef4444" : theme.textSecondary }}>
              {status}
            </div>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-auto overscroll-contain" tabIndex={0} aria-label="PDF Incoming Stock human confirmation table">
          <div className="min-w-[980px]">
            <div className="sticky top-0 z-10 grid grid-cols-[42px_58px_160px_90px_1fr_100px_105px_135px] items-center gap-2 border-b px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider" style={{ backgroundColor: "#0f172a", borderColor: theme.cardBorder, color: theme.textMuted }}>
              <span />
              <span>Line</span>
              <span>Part #</span>
              <span>Ship Qty</span>
              <span>Description</span>
              <span>QOH</span>
              <span>Confidence</span>
              <span>Match</span>
            </div>
            {lines.length === 0 ? (
              <div className="py-14 text-center">
                <FileText className="mx-auto mb-2 h-8 w-8" style={{ color: theme.textMuted }} />
                <div className="text-sm font-bold" style={{ color: theme.textPrimary }}>No PDF lines loaded</div>
                <div className="mt-1 text-xs" style={{ color: theme.textSecondary }}>Choose a packing-list PDF up to 8 MB. No inventory mutation occurs during OCR or review.</div>
              </div>
            ) : lines.map((line) => {
              const presentation = statusLabel(line.matchStatus);
              const selectable = line.matchStatus === "matched" && line.commitStatus !== "received" && line.commitStatus !== "committing";
              return (
                <div key={line.id} className="grid grid-cols-[42px_58px_160px_90px_1fr_100px_105px_135px] items-center gap-2 border-b px-4 py-2.5" style={{ borderColor: theme.cardBorder, backgroundColor: line.selected ? `${theme.accentBlue}0d` : undefined }}>
                  <button
                    type="button"
                    disabled={!selectable}
                    onClick={() => setLines((previous) => previous.map((candidate) => candidate.id === line.id ? { ...candidate, selected: !candidate.selected } : candidate))}
                    aria-label={`Select PDF line ${line.lineNo} for receiving`}
                    className="flex h-5 w-5 items-center justify-center rounded border-2 disabled:opacity-30"
                    style={{ borderColor: line.selected ? theme.accentBlue : theme.cardBorder, backgroundColor: line.selected ? theme.accentBlue : "transparent" }}
                  >
                    {line.selected && <Check className="h-3 w-3 text-white" />}
                  </button>
                  <span className="text-xs" style={{ color: theme.textSecondary }}>{line.lineNo}</span>
                  <span className="text-xs font-bold" style={{ color: theme.accentBlue }}>{(line.resolvedPartNumber ?? line.partNumberOcr) || "—"}</span>
                  <span className="text-xs font-bold" style={{ color: theme.textPrimary }}>{line.qtyOcr ?? "—"}</span>
                  <span className="truncate text-xs" title={line.stockDescription ?? line.descriptionOcr} style={{ color: theme.textSecondary }}>{(line.stockDescription ?? line.descriptionOcr) || "—"}</span>
                  <span className="text-xs font-bold" style={{ color: theme.textPrimary }}>{line.qtyOnHand ?? "—"}</span>
                  <span className="text-xs" style={{ color: theme.textSecondary }}>{line.confidence == null ? "—" : `${Math.round(line.confidence * 100)}%`}</span>
                  <span className="text-[10px] font-bold" style={{ color: line.commitStatus === "failed" ? "#ef4444" : presentation.color }}>
                    {line.commitStatus === "committing" ? "RECEIVING…" : line.commitStatus === "received" ? "RECEIVED" : line.commitStatus === "failed" ? "FAILED" : presentation.label}
                  </span>
                  {line.orderedQty != null && line.qtyOcr != null && line.orderedQty !== line.qtyOcr && (
                    <div className="col-span-8 text-[10px]" style={{ color: "#f59e0b" }}>Ordered {line.orderedQty}, shipped {line.qtyOcr}. RECEIVE uses shipped quantity.</div>
                  )}
                  {line.message && <div className="col-span-8 text-[10px]" style={{ color: line.commitStatus === "failed" ? "#ef4444" : theme.textSecondary }}>{line.message}</div>}
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3" style={{ borderColor: theme.cardBorder, backgroundColor: theme.cardBg }}>
          <div className="text-xs" style={{ color: theme.textSecondary }}>
            {selected.length} exact-match line{selected.length === 1 ? "" : "s"} selected. Unmatched or ambiguous lines cannot be received from this dialog.
          </div>
          <button disabled={busy || commitBusy || selected.length === 0} onClick={() => void commitSelected()} className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-xs font-black text-white disabled:opacity-40" style={{ backgroundColor: theme.statusOk }}>
            {commitBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Confirm & Receive PDF ({selected.length})
          </button>
        </div>
      </WebCard>
    </div>
  );
}

export function IncomingStockDocument() {
  const [showPdf, setShowPdf] = useState(false);
  return (
    <div className="relative">
      <IncomingStockSecure />
      <button
        type="button"
        onClick={() => setShowPdf(true)}
        className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-xl px-4 py-3 text-xs font-black text-white shadow-2xl transition hover:opacity-95"
        style={{ backgroundColor: theme.accentBlue, border: `1px solid ${theme.cardBorder}` }}
        aria-label="Open Incoming Stock PDF packing-list intake"
      >
        <FileText className="h-4 w-4" /> PDF Intake
      </button>
      {showPdf && <PdfIntakeModal onClose={() => setShowPdf(false)} />}
    </div>
  );
}
