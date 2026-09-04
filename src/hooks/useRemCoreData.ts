import { useAction } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { LVCCItem, REMAnalyzer, WeeklyNoteEntry } from "./useConvexData";

type RemCoreData = {
  analyzers: REMAnalyzer[];
  lvccItems: LVCCItem[];
  weeklyNotes: WeeklyNoteEntry[];
};

const EMPTY: RemCoreData = { analyzers: [], lvccItems: [], weeklyNotes: [] };

export function useRemCoreData() {
  const readCore = useAction(api.remReadActions.listCore);
  const [data, setData] = useState<RemCoreData>(EMPTY);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(true);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const result = await readCore();
      if (!active.current) return;
      setData(result as RemCoreData);
    } catch (cause) {
      if (!active.current) return;
      setError(cause instanceof Error ? cause.message : "Unable to load authoritative REM data");
    } finally {
      if (active.current) setIsLoading(false);
    }
  }, [readCore]);

  useEffect(() => {
    active.current = true;
    void refresh();
    const interval = window.setInterval(() => void refresh(), 10_000);
    return () => {
      active.current = false;
      window.clearInterval(interval);
    };
  }, [refresh]);

  return { ...data, isLoading, error, refresh };
}
