/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as ViktorSpacesEmail from "../ViktorSpacesEmail.js";
import type * as auth from "../auth.js";
import type * as bulkImport from "../bulkImport.js";
import type * as constants from "../constants.js";
import type * as cycleCount from "../cycleCount.js";
import type * as dhr from "../dhr.js";
import type * as employees from "../employees.js";
import type * as http from "../http.js";
import type * as kits from "../kits.js";
import type * as parts from "../parts.js";
import type * as rem from "../rem.js";
import type * as remAnalyzers from "../remAnalyzers.js";
import type * as remBuildPlan from "../remBuildPlan.js";
import type * as remLvcc from "../remLvcc.js";
import type * as remStaffing from "../remStaffing.js";
import type * as remTargets from "../remTargets.js";
import type * as remTracker from "../remTracker.js";
import type * as remWeeklyNotes from "../remWeeklyNotes.js";
import type * as seed from "../seed.js";
import type * as seedTestUser from "../seedTestUser.js";
import type * as testAuth from "../testAuth.js";
import type * as transactions from "../transactions.js";
import type * as users from "../users.js";
import type * as viktorTools from "../viktorTools.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  ViktorSpacesEmail: typeof ViktorSpacesEmail;
  auth: typeof auth;
  bulkImport: typeof bulkImport;
  constants: typeof constants;
  cycleCount: typeof cycleCount;
  dhr: typeof dhr;
  employees: typeof employees;
  http: typeof http;
  kits: typeof kits;
  parts: typeof parts;
  rem: typeof rem;
  remAnalyzers: typeof remAnalyzers;
  remBuildPlan: typeof remBuildPlan;
  remLvcc: typeof remLvcc;
  remStaffing: typeof remStaffing;
  remTargets: typeof remTargets;
  remTracker: typeof remTracker;
  remWeeklyNotes: typeof remWeeklyNotes;
  seed: typeof seed;
  seedTestUser: typeof seedTestUser;
  testAuth: typeof testAuth;
  transactions: typeof transactions;
  users: typeof users;
  viktorTools: typeof viktorTools;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
