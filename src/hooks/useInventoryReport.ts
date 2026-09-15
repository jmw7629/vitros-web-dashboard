import { useAction, useConvexAuth } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { PeriodRange } from "../lib/periodHelper";

type Movement = { _id: string; timestamp: number; mode: string; partNumber: string; description: string; qty: number };
export function useInventoryReport(period: PeriodRange) {
  const read = useAction(api.inventoryReportActions.listPeriod);
  const { isAuthenticated } = useConvexAuth();
  const start = period.start.getTime(), end = period.end.getTime();
  const [version, setVersion] = useState(0);
  const key = `${start}:${end}:${version}`;
  const [state, setState] = useState<{ key: string; items: Movement[]; error: string | null; loadedAt: number | null }>({ key: "", items: [], error: null, loadedAt: null });
  useEffect(() => {
    let active = true;
    if (!isAuthenticated) { setState({ key: "", items: [], error: null, loadedAt: null }); return; }
    const loadedAt = Date.now(), snapshotEnd = Math.min(end, loadedAt);
    void (async () => {
      const items: Movement[] = [];
      if (snapshotEnd >= start) {
        for (let offset = 0; ; offset += 500) {
          if (!active) return;
          if (offset > 100000) throw new Error("Report exceeds the supported range");
          const page = await read({ start, end: snapshotEnd, offset });
          items.push(...page.items);
          if (!page.hasMore) break;
        }
      }
      if (active) setState({ key, items, error: null, loadedAt });
    })().catch(() => { if (active) setState({ key, items: [], error: "The complete period could not be loaded. Refresh to retry.", loadedAt: null }); });
    return () => { active = false; };
  }, [read, isAuthenticated, start, end, key]);
  const current = isAuthenticated && state.key === key;
  return { items: current ? state.items : [], isLoading: isAuthenticated && !current, error: current ? state.error : null, loadedAt: current ? state.loadedAt : null, refresh: () => setVersion(v => v + 1) };
}
