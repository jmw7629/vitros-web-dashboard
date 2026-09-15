/**
 * React hook for reading published configuration values.
 * Uses the shared contract from convex/configContract.ts via configRegistry re-export.
 */
import { useConfigContext } from "../components/ConfigProvider";
import { useMemo } from "react";
import {
  type AllConfigKey,
  type NavItemConfig,
  type DashboardModuleConfig,
  type StockSummaryColumnConfig,
  type TransactionSearchFieldConfig,
  type ReportDefinitionConfig,
} from "../lib/configRegistry";

export interface ConfigContextType {
  /** Get a resolved config value (published or default) */
  get: <T = unknown>(key: AllConfigKey) => T;
  /** Get all published values as a Map */
  publishedValues: Map<AllConfigKey, unknown>;
  /** Whether config is still loading */
  isLoading: boolean;
  isPreviewing: (key: AllConfigKey) => boolean;
  /** Get navigation items for a section */
  getNavItems: (section: "inventory" | "rem" | "reports") => NavItemConfig[];
  /** Get dashboard modules */
  getDashboardModules: () => DashboardModuleConfig[];
  /** Get stock summary columns */
  getStockSummaryColumns: () => StockSummaryColumnConfig[];
  /** Get transaction search fields */
  getTransactionSearchFields: () => TransactionSearchFieldConfig[];
  /** Get report definitions */
  getReportDefinitions: () => ReportDefinitionConfig[];
  /** Check if a feature flag is enabled */
  isFeatureEnabled: (flagKey: AllConfigKey) => boolean;
}

export function useConfig(): ConfigContextType {
  const { get, publishedValues, isLoading, isPreviewing } = useConfigContext();

  const getNavItems = useMemo(() => {
    return (section: "inventory" | "rem" | "reports"): NavItemConfig[] => {
      let key: AllConfigKey;
      if (section === "inventory") key = "nav.inventoryItems";
      else if (section === "rem") key = "nav.remItems";
      else key = "nav.inventoryReports";

      const items = get<NavItemConfig[]>(key);
      return items
        .filter((item) => item.visible !== false)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    };
  }, [get]);

  const getDashboardModules = useMemo(() => {
    return (): DashboardModuleConfig[] => {
      const modules = get<DashboardModuleConfig[]>("dashboard.modules");
      return modules
        .filter((m) => m.visible !== false)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    };
  }, [get]);

  const getStockSummaryColumns = useMemo(() => {
    return (): StockSummaryColumnConfig[] => {
      const columns = get<StockSummaryColumnConfig[]>("tables.stockSummary.columns");
      return columns
        .filter((c) => c.visible !== false)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    };
  }, [get]);

  const getTransactionSearchFields = useMemo(() => {
    return (): TransactionSearchFieldConfig[] => {
      const fields = get<TransactionSearchFieldConfig[]>("tables.transactionSearch.columns");
      return fields
        .filter((f) => f.visible !== false)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    };
  }, [get]);

  const getReportDefinitions = useMemo(() => {
    return (): ReportDefinitionConfig[] => {
      const reports = get<ReportDefinitionConfig[]>("reports.definitions");
      return reports
        .filter((r) => r.visible !== false)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    };
  }, [get]);

  const isFeatureEnabled = useMemo(() => {
    return (flagKey: AllConfigKey): boolean => {
      return get<boolean>(flagKey);
    };
  }, [get]);

  return {
    get,
    publishedValues,
    isLoading,
    isPreviewing,
    getNavItems,
    getDashboardModules,
    getStockSummaryColumns,
    getTransactionSearchFields,
    getReportDefinitions,
    isFeatureEnabled,
  };
}

/**
 * Convenience hook for getting a single config value.
 */
export function useConfigValue<T = unknown>(key: AllConfigKey): T | undefined {
  const { get, isLoading } = useConfigContext();
  return isLoading ? undefined : get<T>(key);
}

/**
 * Convenience hook for getting the route labels map.
 */
export function useRouteLabels(): Record<string, string> {
  return useConfigValue<Record<string, string>>("nav.routeLabels") ?? {};
}

/**
 * Convenience hook for getting branding values.
 */
export function useBranding() {
  const get = useConfig();
  return {
    appTitle: get.get<string>("brand.appTitle"),
    sidebarTitle: get.get<string>("brand.sidebarTitle"),
    sidebarSubtitle: get.get<string>("brand.sidebarSubtitle"),
  };
}
