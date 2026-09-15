/** Pure Engineer presentation contract. No role permissions are changed here. */
export const ENGINEER_METRICS = ["skus", "health", "stockOuts", "reorder", "lowStock", "onPlan", "activity", "kits", "today"] as const;
export const ENGINEER_EXCLUDED_ROUTES = ["/sap-staging", "/sap-analytics", "/enterprise-dashboard", "/settings"] as const;
