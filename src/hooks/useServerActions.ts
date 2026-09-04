// Shared hook providing server-side read/write functions for components that need
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

export interface DhrChecklistChangeArgs {
  sessionId: string;
  sectionId: string;
  partNumber: string;
  expectedQty: number;
  newQty: number;
  category: string;
  description: string;
  expectedRevision: number;
  analyzerSerial?: string;
}

export interface DhrScannerBootstrap {
  sections: Record<string, unknown>[];
  expectedParts: Record<string, unknown>[];
  sessions: Record<string, unknown>[];
  employees: Record<string, unknown>[];
}

function canonicalDhrPartNumber(partNumber: string): string {
  return partNumber.trim().toUpperCase();
}

function buildDhrCorrelationId(args: DhrChecklistChangeArgs): string {
  return [
    "dhr",
    args.sessionId,
    args.sectionId.trim(),
    canonicalDhrPartNumber(args.partNumber),
    `r${args.expectedRevision}`,
    `q${args.newQty}`,
  ].join(":");
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
  const loadDhrScannerDataAction = useAction(api.dhrInventoryActions.loadScannerData);
  const loadDhrSessionResultsAction = useAction(api.dhrInventoryActions.loadSessionResults);
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
      if (table === "dhr_scan_results") return deleteDhrSessionWithResults({ sessionId });
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

  const loadDhrScannerData = useCallback(async (): Promise<DhrScannerBootstrap> => {
    return await loadDhrScannerDataAction({}) as unknown as DhrScannerBootstrap;
  }, [loadDhrScannerDataAction]);

  const loadDhrSessionResults = useCallback(async (sessionId: string): Promise<Record<string, unknown>[]> => {
    if (!sessionId.trim()) throw new Error("DHR session is required");
    return await loadDhrSessionResultsAction({ sessionId: sessionId.trim() }) as unknown as Record<string, unknown>[];
  }, [loadDhrSessionResultsAction]);

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

  const applyDhrChecklistChange = useCallback(async (
    args: DhrChecklistChangeArgs,
  ): Promise<DhrTransitionReceipt> => {
    if (!Number.isInteger(args.newQty) || args.newQty < 0) {
      throw new Error("DHR quantity must be a non-negative integer");
    }
    if (!Number.isInteger(args.expectedQty) || args.expectedQty < 0) {
      throw new Error("DHR expected quantity must be a non-negative integer");
    }
    if (!Number.isInteger(args.expectedRevision) || args.expectedRevision < 0) {
      throw new Error("DHR revision must be a non-negative integer");
    }

    const partNumber = canonicalDhrPartNumber(args.partNumber);
    if (!partNumber) throw new Error("DHR part number is required");
    if (!args.sessionId.trim()) throw new Error("DHR session is required");
    if (!args.sectionId.trim()) throw new Error("DHR section is required");

    return applyDhrScanTransition({
      ...args,
      partNumber,
      sectionId: args.sectionId.trim(),
      correlationId: buildDhrCorrelationId({ ...args, partNumber }),
    });
  }, [applyDhrScanTransition]);

  const ocrDhrPage = useCallback(async (args: {
    imageUrl?: string;
    imageBase64?: string;
    prompt: string;
    partList?: string[];
  }): Promise<string> => ocrDhrPageAction(args), [ocrDhrPageAction]);

  return {
    sbInsert,
    sbUpdate,
    sbDelete,
    sbUpload,
    loadDhrScannerData,
    loadDhrSessionResults,
    applyDhrScanTransition,
    applyDhrChecklistChange,
    ocrDhrPage,
  };
}
