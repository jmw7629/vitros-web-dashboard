import { useAction, useConvexAuth, useQuery } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";

export type RemOperationalDataset =
  | "field_status"
  | "lvcc_reviews"
  | "install_parts"
  | "certified_parts"
  | "summary_targets";

export type RemOperationalProduct = "VITROS" | "VISION" | "LVCC_ELECTROMETER" | "LVCC_IR_WASH";

export interface RemOperationalRecord {
  dataset: RemOperationalDataset;
  sourceKey: string;
  sourceSheet: string;
  sourceRow: number;
  data: unknown;
}

interface OperationalPage {
  records: RemOperationalRecord[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

interface OperationalRequest {
  dataset: RemOperationalDataset;
  planYear?: number;
  query?: string;
  product?: string;
  offset?: number;
  limit?: number;
}

/** Read only one authenticated server page; never hydrate the complete workbook. */
export function useRemOperationalData({ dataset, planYear, query = "", product, offset = 0, limit = 50 }: OperationalRequest) {
  const { isAuthenticated, isLoading: authLoading } = useConvexAuth();
  const listRecords = useAction(api.remOperationalImportActions.listOperationalRecords);
  const signal = useQuery(api.realtimePulse.watch, isAuthenticated ? {} : "skip");
  const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit) || 50));
  const safeOffset = Number.isFinite(offset) ? Math.max(0, Math.trunc(offset)) : 0;
  const search = query.trim().slice(0, 160);
  const requestKey = JSON.stringify([dataset, planYear, search, product, safeOffset, safeLimit]);
  const [snapshot, setSnapshot] = useState<{ key: string; page: OperationalPage; loadedAt: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const busy = useRef(false);
  const pendingRefresh = useRef(false);
  const previousSignal = useRef<number | null>(null);
  const pulseTimer = useRef<number | null>(null);

  const refresh = useCallback(() => {
    if (busy.current) {
      pendingRefresh.current = true;
      return;
    }
    setRefreshVersion((version) => version + 1);
  }, []);

  useEffect(() => {
    let active = true;
    pendingRefresh.current = false;
    if (!isAuthenticated) {
      busy.current = false;
      setSnapshot(null);
      setError(null);
      setLoading(false);
      return;
    }
    busy.current = true;
    setLoading(true);
    setError(null);
    void listRecords({ dataset, planYear, offset: safeOffset, limit: safeLimit, query: search || undefined, product })
      .then((page) => {
        if (active) setSnapshot({ key: requestKey, page, loadedAt: Date.now() });
      })
      .catch(() => {
        // Provider errors can contain internal details; keep the UI message bounded.
        if (active) setError("REM source records could not be loaded. Please retry.");
      })
      .finally(() => {
        if (!active) return;
        busy.current = false;
        setLoading(false);
        if (pendingRefresh.current) {
          pendingRefresh.current = false;
          setRefreshVersion((version) => version + 1);
        }
      });
    // A response for an old filter/page or a signed-out session cannot replace data.
    return () => { active = false; };
  }, [dataset, planYear, search, product, safeOffset, safeLimit, requestKey, isAuthenticated, listRecords, refreshVersion]);

  useEffect(() => {
    if (!isAuthenticated || signal === undefined) {
      previousSignal.current = null;
      if (pulseTimer.current !== null) window.clearTimeout(pulseTimer.current);
      pulseTimer.current = null;
      return;
    }
    const previous = previousSignal.current;
    previousSignal.current = signal.version;
    if (previous === null || signal.version <= previous || pulseTimer.current !== null) return;
    // Keep the first timer in a pulse burst so continuous writes cannot starve reads.
    pulseTimer.current = window.setTimeout(() => {
      pulseTimer.current = null;
      if (document.visibilityState === "visible") refresh();
    }, 40 + Math.random() * 200);
  }, [isAuthenticated, signal?.version, refresh]);

  useEffect(() => () => {
    if (pulseTimer.current !== null) window.clearTimeout(pulseTimer.current);
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    let timer: number;
    const reconcile = () => {
      if (cancelled) return;
      if (document.visibilityState === "visible" && !busy.current) refresh();
      timer = window.setTimeout(reconcile, 10000 + Math.random() * 5000);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    timer = window.setTimeout(reconcile, 10000 + Math.random() * 5000);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [isAuthenticated, refresh]);

  const current = isAuthenticated && snapshot?.key === requestKey ? snapshot : null;
  return {
    records: current?.page.records ?? [],
    total: current?.page.total ?? 0,
    hasMore: current?.page.hasMore ?? false,
    offset: safeOffset,
    limit: safeLimit,
    loadedAt: current?.loadedAt ?? null,
    isLoading: authLoading || loading || (isAuthenticated && current === null && error === null),
    isAuthenticated,
    error,
    refresh,
  };
}
