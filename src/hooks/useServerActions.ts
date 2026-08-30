// Shared hook providing server-side write functions for components that need
// direct Supabase writes routed through Convex actions.
import { useAction } from "convex/react";
import { useCallback } from "react";
import { api } from "../../convex/_generated/api";

export function useServerActions() {
  const insertAuditLog = useAction(api.supabaseGateway.insertAuditLog);
  const insertSapStaging = useAction(api.supabaseGateway.insertSapStaging);
  const updateSapStaging = useAction(api.supabaseGateway.updateSapStaging);
  const updateStock = useAction(api.supabaseGateway.updateStock);
  const insertStock = useAction(api.supabaseGateway.insertStock);
  const insertDhrSession = useAction(api.supabaseGateway.insertDhrSession);
  const upsertDhrScanResult = useAction(api.supabaseGateway.upsertDhrScanResult);
  const deleteDhrScanResult = useAction(api.supabaseGateway.deleteDhrScanResult);
  const updateDhrSession = useAction(api.supabaseGateway.updateDhrSession);
  const deleteDhrSession = useAction(api.supabaseGateway.deleteDhrSession);
  const deleteDhrSessionWithResults = useAction(api.supabaseGateway.deleteDhrSessionWithResults);
  const uploadToStorage = useAction(api.supabaseGateway.uploadToStorage);

  const sbInsert = useCallback(async (table: string, data: Record<string, unknown>) => {
    switch (table) {
      case "audit_log": return insertAuditLog({ data });
      case "sap_staging": return insertSapStaging({ data });
      case "stock": return insertStock({ data });
      case "dhr_scan_sessions": return insertDhrSession({ data });
      case "dhr_scan_results": return upsertDhrScanResult({ data });
      default: throw new Error(`Unsupported table: ${table}`);
    }
  }, [insertAuditLog, insertSapStaging, insertStock, insertDhrSession, upsertDhrScanResult]);

  const sbUpdate = useCallback(async (table: string, filter: string, data: Record<string, unknown>) => {
    const idMatch = filter.match(/id=eq\.(.+)/);
    const id = idMatch?.[1];
    if (!id) throw new Error(`Invalid filter: ${filter}`);
    switch (table) {
      case "stock": return updateStock({ id, data });
      case "dhr_scan_sessions": return updateDhrSession({ id, data });
      case "dhr_scan_results": return upsertDhrScanResult({ id, data });
      case "sap_staging": return updateSapStaging({ id, data });
      default: throw new Error(`Unsupported table: ${table}`);
    }
  }, [updateStock, updateDhrSession, upsertDhrScanResult, updateSapStaging]);

  const sbDelete = useCallback(async (table: string, filter: string) => {
    if (table === "dhr_scan_results" && filter.includes("session_id=eq.")) {
      const sessionId = filter.split("session_id=eq.")[1];
      return deleteDhrSessionWithResults({ sessionId });
    }
    const idMatch = filter.match(/id=eq\.(.+)/);
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

  return { sbInsert, sbUpdate, sbDelete, sbUpload };
}
