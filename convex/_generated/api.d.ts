/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as aiAdminActions from "../aiAdminActions.js";
import type * as zenRuntime from "../zenRuntime.js";
import type * as aiControl from "../aiControl.js";
import type * as aiContract from "../aiContract.js";
import type * as ViktorSpacesEmail from "../ViktorSpacesEmail.js";
import type * as adminSettingsActions from "../adminSettingsActions.js";
import type * as aiGateway from "../aiGateway.js";
import type * as auth from "../auth.js";
import type * as authGuard from "../authGuard.js";
import type * as bulkImport from "../bulkImport.js";
import type * as configActions from "../configActions.js";
import type * as configContract from "../configContract.js";
import type * as configDefaults from "../configDefaults.js";
import type * as configMutations from "../configMutations.js";
import type * as constants from "../constants.js";
import type * as cycleCountActions from "../cycleCountActions.js";
import type * as cycleCountContract from "../cycleCountContract.js";
import type * as cycleCount from "../cycleCount.js";
import type * as dhr from "../dhr.js";
import type * as dhrDocumentActions from "../dhrDocumentActions.js";
import type * as dhrInventoryActions from "../dhrInventoryActions.js";
import type * as employeeAccess from "../employeeAccess.js";
import type * as employeeActions from "../employeeActions.js";
import type * as employeeIdentity from "../employeeIdentity.js";
import type * as employees from "../employees.js";
import type * as http from "../http.js";
import type * as incomingStockActions from "../incomingStockActions.js";
import type * as incomingStockDeterministicIdentity from "../incomingStockDeterministicIdentity.js";
import type * as incomingStockPdfOcr from "../incomingStockPdfOcr.js";
import type * as incomingStockReview from "../incomingStockReview.js";
import type * as inventoryActions from "../inventoryActions.js";
import type * as inventoryReportActions from "../inventoryReportActions.js";
import type * as kits from "../kits.js";
import type * as partMasterActions from "../partMasterActions.js";
import type * as parts from "../parts.js";
import type * as realtimePulse from "../realtimePulse.js";
import type * as realtimePulsePublisher from "../realtimePulsePublisher.js";
import type * as rem from "../rem.js";
import type * as remAnalyzers from "../remAnalyzers.js";
import type * as remBuildPlan from "../remBuildPlan.js";
import type * as remLvcc from "../remLvcc.js";
import type * as remOperationalActions from "../remOperationalActions.js";
import type * as remOperationalImportActions from "../remOperationalImportActions.js";
import type * as remOperationalImportValidation from "../remOperationalImportValidation.js";
import type * as remProgressActions from "../remProgressActions.js";
import type * as remReadActions from "../remReadActions.js";
import type * as remStaffing from "../remStaffing.js";
import type * as remTargets from "../remTargets.js";
import type * as remTracker from "../remTracker.js";
import type * as remWeeklyNotes from "../remWeeklyNotes.js";
import type * as remWorkbookActions from "../remWorkbookActions.js";
import type * as roleIdentity from "../roleIdentity.js";
import type * as roleSignInLimiter from "../roleSignInLimiter.js";
import type * as sapStagingWorkflow from "../sapStagingWorkflow.js";
import type * as seed from "../seed.js";
import type * as seedTestUser from "../seedTestUser.js";
import type * as supabaseGateway from "../supabaseGateway.js";
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
  aiAdminActions: typeof aiAdminActions;
  zenRuntime: typeof zenRuntime;
  aiControl: typeof aiControl;
  aiContract: typeof aiContract;
  ViktorSpacesEmail: typeof ViktorSpacesEmail;
  adminSettingsActions: typeof adminSettingsActions;
  aiGateway: typeof aiGateway;
  auth: typeof auth;
  authGuard: typeof authGuard;
  bulkImport: typeof bulkImport;
  configActions: typeof configActions;
  configContract: typeof configContract;
  configDefaults: typeof configDefaults;
  configMutations: typeof configMutations;
  constants: typeof constants;
  cycleCount: typeof cycleCount;
  cycleCountActions: typeof cycleCountActions;
  cycleCountContract: typeof cycleCountContract;
  dhr: typeof dhr;
  dhrDocumentActions: typeof dhrDocumentActions;
  dhrInventoryActions: typeof dhrInventoryActions;
  employeeAccess: typeof employeeAccess;
  employeeActions: typeof employeeActions;
  employeeIdentity: typeof employeeIdentity;
  employees: typeof employees;
  http: typeof http;
  incomingStockActions: typeof incomingStockActions;
  incomingStockDeterministicIdentity: typeof incomingStockDeterministicIdentity;
  incomingStockPdfOcr: typeof incomingStockPdfOcr;
  incomingStockReview: typeof incomingStockReview;
  inventoryActions: typeof inventoryActions;
  inventoryReportActions: typeof inventoryReportActions;
  kits: typeof kits;
  partMasterActions: typeof partMasterActions;
  parts: typeof parts;
  realtimePulse: typeof realtimePulse;
  realtimePulsePublisher: typeof realtimePulsePublisher;
  rem: typeof rem;
  remAnalyzers: typeof remAnalyzers;
  remBuildPlan: typeof remBuildPlan;
  remLvcc: typeof remLvcc;
  remOperationalActions: typeof remOperationalActions;
  remOperationalImportActions: typeof remOperationalImportActions;
  remOperationalImportValidation: typeof remOperationalImportValidation;
  remProgressActions: typeof remProgressActions;
  remReadActions: typeof remReadActions;
  remStaffing: typeof remStaffing;
  remTargets: typeof remTargets;
  remTracker: typeof remTracker;
  remWeeklyNotes: typeof remWeeklyNotes;
  remWorkbookActions: typeof remWorkbookActions;
  roleIdentity: typeof roleIdentity;
  roleSignInLimiter: typeof roleSignInLimiter;
  sapStagingWorkflow: typeof sapStagingWorkflow;
  seed: typeof seed;
  seedTestUser: typeof seedTestUser;
  supabaseGateway: typeof supabaseGateway;
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
