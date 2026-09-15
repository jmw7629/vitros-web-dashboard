/**
 * VITROS Dashboard Routing — role-based default route resolution.
 *
 * Single source of truth for role landing routes. Uses published configuration
 * with runtime defaults. No hardcoded fallbacks in presentation components.
 */
import { getConfigDefault } from "../../convex/configContract";
import type { AllConfigKey } from "../../convex/configContract";

export type RoleName = "superuser" | "engineer" | "viewer";

export interface RoleRouteConfig {
  superuser: string;
  engineer: string;
  viewer: string;
}

/** Config keys for role default routes */
export const ROLE_ROUTE_KEYS = {
  superuser: "roles.superuserDefaultRoute" as AllConfigKey,
  engineer: "roles.engineerDefaultRoute" as AllConfigKey,
  viewer: "roles.viewerDefaultRoute" as AllConfigKey,
} as const;

/** Validate a route is a known application route */
function isKnownRoute(route: string): boolean {
  const knownRoutes = [
    "/dashboard",
    "/engineer-dashboard",
    "/scan-kiosk",
    "/user-dashboard",
    "/stock-summary",
    "/incoming-stock",
    "/reorder-stockout",
    "/transaction-search",
    "/aged-inventory",
    "/wip-cycle-time",
    "/inventory-turnover",
    "/inventory-accuracy",
    "/analyzer-analysis",
    "/abc-analysis",
    "/kit-analysis",
    "/sap-staging",
    "/sap-analytics",
    "/cycle-count",
    "/dhr-scanner",
    "/health-heatmap",
    "/e-connectivity",
    "/executive-report",
    "/mobile-quick-view",
    "/report-preview",
    "/upload-refresh",
    "/settings",
    "/rem/dashboard",
    "/rem/morning-snapshot",
    "/rem/kanban",
    "/rem/gantt",
    "/rem/kiosk",
    "/rem/analyzers",
    "/rem/lvcc",
    "/rem/production-plan",
    "/rem/field-status",
    "/rem/staff",
    "/rem/notes",
    "/rem/reports",
    "/rem/reports-v2",
    "/rem/import",
    "/inventory-reports",
  ];
  return knownRoutes.includes(route);
}

/**
 * Safe fallback routes per role. Used when config is invalid or inaccessible.
 */
const SAFE_FALLBACKS: RoleRouteConfig = {
  superuser: "/dashboard",
  engineer: "/engineer-dashboard",
  viewer: "/dashboard",
};

/**
 * Resolve the default dashboard route for a role.
 * Priority: published config > runtime default > hardcoded safe fallback.
 * Rejects configured routes that are inaccessible to the role.
 */
export function getRoleDefaultRoute(
  role: RoleName,
  publishedValues: Map<string, unknown>,
  overlayValues?: Map<string, unknown>,
): string {
  const key = ROLE_ROUTE_KEYS[role];
  let value: unknown;

  if (overlayValues?.has(key)) {
    value = overlayValues.get(key);
  } else if (publishedValues.has(key)) {
    value = publishedValues.get(key);
  } else {
    value = getConfigDefault(key);
  }

  if (typeof value === "string" && isKnownRoute(value) && isRouteAccessibleByRole(value, role)) {
    return value;
  }

  return SAFE_FALLBACKS[role];
}

/**
 * Get all role default routes as a config object.
 * Used for bulk resolution in layout components.
 */
export function getAllRoleDefaultRoutes(
  publishedValues: Map<string, unknown>,
  overlayValues?: Map<string, unknown>,
): RoleRouteConfig {
  return {
    superuser: getRoleDefaultRoute("superuser", publishedValues, overlayValues),
    engineer: getRoleDefaultRoute("engineer", publishedValues, overlayValues),
    viewer: getRoleDefaultRoute("viewer", publishedValues, overlayValues),
  };
}

/**
 * Routes inaccessible to engineers (admin/SAP/system).
 * Server RBAC is the authority; this is a presentation guard only.
 */
const ENGINEER_BLOCKED = new Set<string>([
  "/sap-staging",
  "/sap-analytics",
  "/enterprise-dashboard",
]);

/**
 * Routes inaccessible to viewers (write/mutate paths).
 */
const VIEWER_BLOCKED = new Set<string>([
  "/scan-kiosk",
  "/incoming-stock",
  "/reorder-stockout",
  "/cycle-count",
  "/dhr-scanner",
  "/sap-staging",
  "/rem/import",
  "/rem/kiosk",
  "/rem/kanban",
  "/rem/gantt",
  "/rem/staff",
  "/rem/notes",
]);

/**
 * Check if a route is accessible by a role.
 * Presentation guard only — server RBAC is the authority.
 */
export function isRouteAccessibleByRole(route: string, role: RoleName): boolean {
  if (role === "engineer" && ENGINEER_BLOCKED.has(route)) return false;
  if (role === "viewer" && VIEWER_BLOCKED.has(route)) return false;
  return true;
}

/**
 * Filter navigation items for a role based on route accessibility.
 * Presentation filter only — server RBAC remains the authority.
 */
export function filterNavItemsForRole<T extends { path: string }>(
  items: T[],
  role: RoleName,
): T[] {
  return items.filter((item) => isRouteAccessibleByRole(item.path, role));
}