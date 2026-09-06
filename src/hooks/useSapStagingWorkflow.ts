import { useAction } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";

export type SapExportStatus = "pending" | "ready" | "exported" | "posted" | "error";

export interface AuthoritativeSapRecord {
  _id: string;
  timestamp: number;
  mode: string;
  partNumber: string;
  description: string;
  qty: number;
  qtyBefore: number;
  qtyAfter: number;
  movementType: string;
  plantCode: string;
  storageLocation: string;
  exportStatus: SapExportStatus;
  exportedAt?: number;
  exportedBy?: string;
  user: string;
}

function movementMode(rawMode: unknown, rawMovementType: unknown): string {
  const mode = String(rawMode ?? "").trim().toUpperCase();
  if (mode) return mode;
  switch (String(rawMovementType ?? "").trim()) {
    case "261": return "OUT";
    case "101": return "RECEIVE";
    case "309": return "ADJUST";
    default: return "";
  }
}

function movementQty(row: any): number {
  const explicit = Number(row.qty);
  if (Number.isFinite(explicit) && explicit !== 0) return Math.abs(explicit);

  const before = row.qty_before === null || row.qty_before === undefined ? null : Number(row.qty_before);
  const after = row.qty_after === null || row.qty_after === undefined ? null : Number(row.qty_after);
  if (before !== null && after !== null && Number.isFinite(before) && Number.isFinite(after)) {
    return Math.abs(after - before);
  }

  const legacy = Number(row.qty_on_hand);
  return Number.isFinite(legacy) ? Math.abs(legacy) : 0;
}

function normalizeStatus(value: unknown): SapExportStatus {
  const status = String(value ?? "pending").trim().toLowerCase();
  if (status === "ready" || status === "exported" || status === "posted" || status === "error") return status;
  return "pending";
}

function mapRow(row: any): AuthoritativeSapRecord {
  const exportedAt = row.exported_at ? new Date(row.exported_at).getTime() : undefined;
  return {
    _id: String(row.id),
    timestamp: row.created_at ? new Date(row.created_at).getTime() : 0,
    mode: movementMode(row.mode, row.movement_type),
    partNumber: String(row.part_number ?? ""),
    description: String(row.description ?? ""),
    qty: movementQty(row),
    qtyBefore: Number(row.qty_before ?? 0),
    qtyAfter: Number(row.qty_after ?? 0),
    movementType: String(row.movement_type ?? ""),
    plantCode: String(row.plant_code ?? ""),
    storageLocation: String(row.storage_location ?? ""),
    exportStatus: normalizeStatus(row.export_status),
    exportedAt: exportedAt && Number.isFinite(exportedAt) ? exportedAt : undefined,
    exportedBy: row.exported_by ? String(row.exported_by) : undefined,
    user: row.exported_by ? String(row.exported_by) : "",
  };
}

async function deterministicCorrelation(targetStatus: "ready" | "exported", ids: string[]): Promise<string> {
  const canonical = `${targetStatus}:${[...ids].sort().join(",")}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `sap:${targetStatus}:${hex.slice(0, 48)}`;
}

export function useSapStagingWorkflow() {
  const listSapStaging = useAction(api.supabaseGateway.listSapStaging);
  const transitionAction = useAction((api as any).sapStagingWorkflow.transition);
  const [records, setRecords] = useState<AuthoritativeSapRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isMutating, setIsMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (showLoading = false) => {
    if (showLoading) setIsLoading(true);
    try {
      const rows = await listSapStaging();
      if (!mountedRef.current) return;
      setRecords((Array.isArray(rows) ? rows : []).map(mapRow));
      setError(null);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : "Unable to load SAP staging");
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, [listSapStaging]);

  useEffect(() => {
    mountedRef.current = true;
    void load(true);

    const schedule = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (document.visibilityState !== "visible") return;
      const delay = 8000 + Math.floor(Math.random() * 4001);
      timerRef.current = setTimeout(async () => {
        await load(false);
        schedule();
      }, delay);
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void load(false).finally(schedule);
      } else if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const onOnline = () => void load(false).finally(schedule);
    schedule();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);

    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
    };
  }, [load]);

  const transition = useCallback(async (ids: string[], targetStatus: "ready" | "exported") => {
    if (ids.length === 0) return;
    setIsMutating(true);
    setError(null);
    const correlationId = await deterministicCorrelation(targetStatus, ids);
    try {
      const receipt = await transitionAction({ ids, targetStatus, correlationId });
      await load(false);
      return receipt;
    } catch (err) {
      // A transport failure may happen after the database committed. Reconcile before
      // reporting the error; the deterministic correlation makes a retry idempotent.
      await load(false);
      const message = err instanceof Error ? err.message : "SAP staging transition failed";
      setError(message);
      throw err;
    } finally {
      if (mountedRef.current) setIsMutating(false);
    }
  }, [load, transitionAction]);

  return {
    records,
    isLoading,
    isMutating,
    error,
    refresh: () => load(false),
    markReady: (ids: string[]) => transition(ids, "ready"),
    markExported: (ids: string[]) => transition(ids, "exported"),
  };
}
