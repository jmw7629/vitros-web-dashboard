import { useConfig } from "./useConfig";
import { useMemo } from "react";

/**
 * Hook for formatting dates according to config (dateFormat, timezone).
 */
export function useFormatDate() {
  const { get } = useConfig();
  const dateFormat = get<string>("defaults.dateFormat");
  const timezone = get<string>("defaults.timezone");

  return useMemo(() => {
    return (timestamp: number): string => {
      const d = new Date(timestamp);
      if (timezone === "local") {
        return d.toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          hour12: dateFormat.includes("A"),
        });
      }
      return d.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: dateFormat.includes("A"),
        timeZone: timezone,
      });
    };
  }, [dateFormat, timezone]);
}

/**
 * Hook for getting the configured currency symbol.
 */
export function useCurrency() {
  const { get } = useConfig();
  return useMemo(() => get<string>("defaults.currency"), [get]);
}
