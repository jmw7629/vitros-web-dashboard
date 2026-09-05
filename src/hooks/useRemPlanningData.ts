import { useAction } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";

export type RemTrackerPlanningRow = {
  _id: string;
  year: number;
  product: string;
  quarter: string;
  weekNumber: number;
  weekStart?: string;
  plan: number;
  actual?: number;
  weeklyForecast?: number;
  accumulatedForecast?: number;
};

export type RemBuildPlanRow = {
  _id: string;
  year: number;
  quarter: string;
  weekNumber: number;
  weekStart?: string;
  delivery: {
    analyzer3600?: number;
    analyzer5600?: number;
    analyzer7600?: number;
    vision?: number;
    electrometer?: number;
    irWash?: number;
    total?: number;
  };
  capacity: {
    meets?: number;
    exceeds?: number;
    capacity?: number;
    delta?: number;
    headCount?: number;
    onboarding?: number;
    inTraining?: number;
    holidays?: number;
    ptoDays?: number;
  };
  actuals: {
    analyzer3600?: number;
    analyzer5600?: number;
    analyzer7600?: number;
    vitrosVsPlan?: number;
    vision?: number;
    electrometer?: number;
    irWash?: number;
  };
};

export type RemStaffPlanningRow = {
  _id: string;
  name: string;
  role?: string;
  wwid?: string;
  fte?: number;
  started?: string;
  completeAfter?: string;
  trainingUntil?: string;
  comment?: string;
  skills: { name: string; value: string }[];
  certifications: { name: string; value: string }[];
};

export type RemTargetPlanningRow = {
  _id: string;
  year: number;
  targetType: string;
  product?: string;
  targetValue: number;
  actualValue: number;
};

type RemPlanningData = {
  trackerWeekly: RemTrackerPlanningRow[];
  buildPlan: RemBuildPlanRow[];
  staff: RemStaffPlanningRow[];
  targets: RemTargetPlanningRow[];
};

const EMPTY: RemPlanningData = { trackerWeekly: [], buildPlan: [], staff: [], targets: [] };

export function useRemPlanningData() {
  const readPlanning = useAction(api.remReadActions.listPlanning);
  const [data, setData] = useState<RemPlanningData>(EMPTY);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(true);
  const inFlight = useRef<Promise<void> | null>(null);

  const refresh = useCallback(async () => {
    if (inFlight.current) return inFlight.current;

    const request = (async () => {
      if (active.current) setError(null);
      try {
        const result = await readPlanning();
        if (!active.current) return;
        setData(result as RemPlanningData);
      } catch (cause) {
        if (!active.current) return;
        setError(cause instanceof Error ? cause.message : "Unable to load authoritative REM planning data");
      } finally {
        if (active.current) setIsLoading(false);
      }
    })();

    inFlight.current = request;
    try {
      await request;
    } finally {
      if (inFlight.current === request) inFlight.current = null;
    }
  }, [readPlanning]);

  useEffect(() => {
    active.current = true;
    void refresh();

    const interval = window.setInterval(() => {
      if (!document.hidden) void refresh();
    }, 15_000);
    const handleVisibility = () => {
      if (!document.hidden) void refresh();
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      active.current = false;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [refresh]);

  return { ...data, isLoading, error, refresh };
}
