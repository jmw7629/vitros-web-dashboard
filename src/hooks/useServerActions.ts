// Shared hook providing server-side write functions for components that need
// Supabase-backed operations routed through validated Convex actions.
import { useAction } from "convex/react";
import { useCallback } from "react";
import { api } from "../../convex/_generated/api";

export interface DhrTransitionReceipt {
  success: boolean;
  duplicate: boolean;
  eventId: string;
  resultId: string;
  sessionId: string;
  sectionId: string;
  partNumber: string;
  previousQty: number;
  newQty: number;
  delta: number;
  revisionBefore: number;
  revisionAfter: number;
  mode: "IN" | "OUT" | null;
  stockBefore?: number | null;
  stockAfter?: number | null;
  auditId?: string | null;
  sapId?: string | null;
  processedAt: string;
}

export function useServerActions() {
  const insertAuditLog = useAction(api.supabaseGateway.insertAuditLog);
  const insertSapStaging = useAction(api.supabaseGateway.insertSapStaging);
  const updateSapStaging = useAction(api.supabaseGateway.updateSapStaging);
  const insertDhrSession = useAction(api.supabaseGateway.insertDhrSession);
  const upsertDhrScanResult = useAction(api.supabaseGateway.upsertDhrScanResult);
  const deleteDhrScanResult = useAction(api.supabaseGateway.deleteDhrScanResult);
  const updateDhrSession = useAction(api.supabaseGateway.updateDhrSession);
  const deleteDhrSession = useAction(api.supabaseGateway.deleteDhrSession);
  const deleteDhrSessionWithResults = useAction(api.supabaseGateway.deleteDhrSessionWithResults);
  const uploadToStorage = useAction(api.supabaseGateway.uploadToStorage);
  const applyDhrScanTransitionAction = useAction(api.dhrInventoryActions.applyScanTransition);
  const ocrDhrPageAction = useAction(api.aiGateway.ocrDhrPage);

  const sbInsert = useCallback(async (table: string, data: Record<string, unknown>) => {
    switch (table) {
      case "audit_log": return insertAuditLog({ data });
      case "sap_staging": return insertSapStaging({ data });
      case "dhr_scan_sessions": return insertDhrSession({ data });
      case "dhr_scan_results": return upsertDhrScanResult({ data });
      case "stock": throw new Error("Direct stock insert is not permitted from this adapter");
      default: throw new Error(`Unsupported table: ${table}`);
    }
  }, [insertAuditLog, insertSapStaging, insertDhrSession, upsertDhrScanResult]);

  const sbUpdate = useCallback(async (table: string, filter: string, data: Record<string, unknown>) => {
    const idMatch = filter.match(/id=eq\.([^&]+)/);
    const id = idMatch?.[1];
    if (!id) throw new Error(`Invalid filter: ${filter}`);
    switch (table) {
      case "dhr_scan_sessions": return updateDhrSession({ id, data });
      case "dhr_scan_results": return upsertDhrScanResult({ id, data });
      case "sap_staging": return updateSapStaging({ id, data });
      case "stock": throw new Error("Direct stock quantity updates are not permitted; use inventory transition actions");
      default: throw new Error(`Unsupported table: ${table}`);
    }
  }, [updateDhrSession, upsertDhrScanResult, updateSapStaging]);

  const sbDelete = useCallback(async (table: string, filter: string) => {
    if (filter.includes("session_id=eq.")) {
      const sessionId = filter.split("session_id=eq.")[1]?.split("&")[0];
      if (!sessionId) throw new Error(`Invalid session filter: ${filter}`);
      if (table === "dhr_scan_results") {
        return deleteDhrSessionWithResults({ sessionId });
      }
    }

    const idMatch = filter.match(/id=eq\.([^&]+)/);
    const id = idMatch?.[1];
    if (!id) throw new Error(`Invalid filter: ${filter}`);
    switch (table) {
      case "dhr_scan_results": return deleteDhrScanResult({ id });
      case "dhr_scan_sessions": return deleteDhrSession({ id });
      default: throw new Error(`Unsupported table: ${table}`);
    }
  }, [deleteDhrScanResult, deleteDhrSession, deleteDhrSessionWithResults]);

  const sbUpload = useCallback(async (bucket: string, path: string, data: string, contentType: string) => {
    return uploadToStorage({ bucket, path, data, contentType });
  }, [uploadToStorage]);

  const applyDhrScanTransition = useCallback(async (args: {
    sessionId: string;
    sectionId: string;
    partNumber: string;
    expectedQty: number;
    newQty: number;
    category: string;
    description: string;
    correlationId: string;
    expectedRevision: number;
    analyzerSerial?: string;
  }): Promise<DhrTransitionReceipt> => {
    return await applyDhrScanTransitionAction(args) as unknown as DhrTransitionReceipt;
  }, [applyDhrScanTransitionAction]);

  const ocrDhrPage = useCallback(async (args: {
    imageUrl: string;
    prompt: string;
    partList?: string[];
  }): Promise<string> => ocrDhrPageAction(args), [ocrDhrPageAction]);

  return { sbInsert, sbUpdate, sbDelete, sbUpload, applyDhrScanTransition, ocrDhrPage };
}