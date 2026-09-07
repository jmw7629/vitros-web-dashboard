import { useEffect, useRef } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useConvexData } from "../hooks/useConvexData";

const REALTIME_REFRESH_MIN_MS = 40;
const REALTIME_REFRESH_MAX_MS = 240;

/**
 * Converts the payload-free Convex invalidation signal into an authoritative
 * refresh of the existing data provider. A small jitter spreads 30-client fanout
 * while remaining far below the two-second propagation objective. The provider's
 * coalescing runner prevents overlapping full refreshes.
 */
export function RealtimeRefreshBridge() {
  const { isAuthenticated } = useConvexAuth();
  const signal = useQuery(api.realtimePulse.watch, isAuthenticated ? {} : "skip");
  const { refresh } = useConvexData();
  const lastVersionRef = useRef<number | null>(null);
  const refreshTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isAuthenticated) {
      lastVersionRef.current = null;
      return;
    }
    if (signal === undefined) return;

    const previousVersion = lastVersionRef.current;
    if (previousVersion !== null && signal.version <= previousVersion) return;
    lastVersionRef.current = signal.version;

    // Keep the first scheduled refresh when several commits arrive together.
    // The provider refresh is authoritative and will observe all committed rows.
    if (refreshTimerRef.current !== null) return;

    const spread = REALTIME_REFRESH_MAX_MS - REALTIME_REFRESH_MIN_MS;
    const delay = REALTIME_REFRESH_MIN_MS + Math.floor(Math.random() * (spread + 1));
    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = null;
      void refresh();
    }, delay);
  }, [isAuthenticated, refresh, signal]);

  useEffect(() => () => {
    if (refreshTimerRef.current !== null) {
      window.clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
  }, []);

  return null;
}
