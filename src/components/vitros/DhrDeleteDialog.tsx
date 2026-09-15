import { useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";

export interface DhrDeleteTarget {
  id: string; instrument_sn: string; revision: number;
}
export function DhrDeleteDialog({ session, onDelete, onClose }: {
  session: DhrDeleteTarget;
  onDelete: (args: { sessionId: string; expectedRevision: number; reason: string; correlationId: string }) => Promise<void>;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  // Keep one operation identity through a lost response and retry.
  const request = useRef<{ correlationId: string; reason: string } | null>(null);
  const remove = async () => {
    const value = reason.trim();
    if (pending.current || !value || value.length > 500) return;
    if (!request.current || request.current.reason !== value) {
      request.current = { correlationId: crypto.randomUUID(), reason: value };
    }
    pending.current = true; setBusy(true); setError(null);
    try {
      await onDelete({ sessionId: session.id, expectedRevision: session.revision, ...request.current });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Deletion failed. Please retry.");
    } finally {
      pending.current = false; setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(open) => { if (!open && !pending.current) onClose(); }}>
      <DialogContent showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>Delete DHR {session.instrument_sn}?</DialogTitle>
          <DialogDescription>
            This removes the DHR from the active list and prevents further edits.
            Its audit history is retained. Consumed parts will not be returned to stock,
            and existing SAP records will remain unchanged.
          </DialogDescription>
        </DialogHeader>
        <label htmlFor="dhr-delete-reason" className="text-sm font-semibold">Reason for deletion</label>
        <textarea id="dhr-delete-reason" value={reason} maxLength={500} disabled={busy}
          onChange={(event) => setReason(event.target.value)}
          className="min-h-24 rounded-md border bg-transparent p-3 text-sm" />
        {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
        <div className="flex justify-end gap-2">
          <button disabled={busy} onClick={onClose} className="rounded-md border px-4 py-2 text-sm">Cancel</button>
          <button disabled={busy || !reason.trim()} onClick={() => void remove()}
            className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {busy ? "Deleting…" : "Delete DHR"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
