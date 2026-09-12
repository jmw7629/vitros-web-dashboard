import { Password } from "@convex-dev/auth/providers/Password";
import { ConvexCredentials } from "@convex-dev/auth/providers/ConvexCredentials";
import { convexAuth, createAccount, getAuthUserId } from "@convex-dev/auth/server";
import { Scrypt } from "lucia";
import { internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { internalAction, query } from "./_generated/server";
import { v } from "convex/values";
import { TestCredentials } from "./testAuth";
import { assertEmployeeAccess } from "./employeeAccess";
import {
  ViktorSpacesEmail,
  ViktorSpacesPasswordReset,
} from "./ViktorSpacesEmail";

declare const process: { env: Record<string, string | undefined> };

function decodePrivateKey(key: string | undefined): string | undefined {
  if (!key) return undefined;
  if (key.includes("\n")) return key;
  if (key.startsWith("-----BEGIN")) {
    return key
      .replace("-----BEGIN PRIVATE KEY----- ", "-----BEGIN PRIVATE KEY-----\n")
      .replace(" -----END PRIVATE KEY-----", "\n-----END PRIVATE KEY-----")
      .split(" ")
      .join("\n");
  }
  try {
    return atob(key);
  } catch {
    return key;
  }
}

const authPrivateKey = process.env.AUTH_PRIVATE_KEY;
if (authPrivateKey) {
  process.env.AUTH_PRIVATE_KEY = decodePrivateKey(authPrivateKey);
}

const jwtPrivateKey = process.env.JWT_PRIVATE_KEY;
if (jwtPrivateKey) {
  process.env.JWT_PRIVATE_KEY = decodePrivateKey(jwtPrivateKey);
}

type RoleIdentity = {
  accountId: string;
  name: string;
  role: "engineer" | "superuser";
};

function supabaseServerConfig() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("Server identity configuration is unavailable");
  return { url: url.replace(/\/$/, ""), serviceKey };
}

async function resolveActiveEmployee(initials: string): Promise<RoleIdentity> {
  const normalized = initials.trim().toUpperCase();
  if (!/^[A-Z0-9]{1,4}$/.test(normalized)) {
    throw new Error("Employee initials are invalid");
  }

  const { url, serviceKey } = supabaseServerConfig();
  const endpoint = `${url}/rest/v1/rpc/resolve_active_employee_login`;
  const response = await fetch(endpoint, {
    method: "POST",
    body: JSON.stringify({ p_initials: normalized }),
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
  });
  if (!response.ok) throw new Error("Employee identity verification is unavailable");
  const rows = await response.json() as Array<{ id?: string; name?: string; initials?: string; active?: boolean }>;
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new Error("Employee initials are not active or are ambiguous");
  }
  const employee = rows[0];
  if (typeof employee.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(employee.id)
    || typeof employee.name !== "string" || !employee.name.trim()
    || typeof employee.initials !== "string" || employee.initials.trim().toUpperCase() !== normalized
    || employee.active !== true) {
    throw new Error("Employee initials are not active or are ambiguous");
  }
  return {
    accountId: `employee:${employee.id}`,
    name: employee.name,
    role: "engineer",
  };
}

async function verifySuperuserSecret(secret: string): Promise<RoleIdentity> {
  if (!secret || secret.length > 256) throw new Error("Superuser verification failed");
  const hash = process.env.VITROS_SUPERUSER_PASSWORD_HASH;
  if (!hash) throw new Error("Superuser sign-in is not configured");

  let valid = false;
  try {
    valid = await new Scrypt().verify(hash, secret);
  } catch {
    valid = false;
  }
  if (!valid) throw new Error("Superuser verification failed");
  return { accountId: "superuser", name: "Superuser", role: "superuser" };
}

// This action is internal-only. The browser never receives the Supabase service
// credential or the configured superuser password hash.
export const validateRoleSelection = internalAction({
  args: {
    role: v.union(v.literal("engineer"), v.literal("superuser")),
    initials: v.optional(v.string()),
    secret: v.optional(v.string()),
  },
  returns: v.object({
    accountId: v.string(),
    name: v.string(),
    role: v.union(v.literal("engineer"), v.literal("superuser")),
  }),
  handler: async (_ctx, args) => {
    if (args.role === "engineer") {
      return await resolveActiveEmployee(args.initials ?? "");
    }
    return await verifySuperuserSecret(args.secret ?? "");
  },
});

function VitrosRoleCredentials() {
  return ConvexCredentials<DataModel>({
    id: "vitros-role",
    authorize: async (params, ctx) => {
      const requestedRole = params.role;
      if (requestedRole !== "engineer" && requestedRole !== "superuser") {
        throw new Error("Invalid VITROS role selection");
      }

      const identity = await ctx.runAction(internal.auth.validateRoleSelection, {
        role: requestedRole,
        initials: typeof params.initials === "string" ? params.initials : undefined,
        secret: typeof params.secret === "string" ? params.secret : undefined,
      });

      // Only the server-resolved active canonical identity may initialize access.
      // Existing blocked/pending barriers are never cleared by signing in.
      if (identity.role === "engineer") {
        await ctx.runMutation(internal.employeeAccess.provisionVerifiedEmployeeAccess, {
          employeeId: identity.accountId.slice("employee:".length),
        });
      }

      const { user } = await createAccount(ctx, {
        provider: "vitros-role",
        account: { id: identity.accountId },
        profile: {
          name: identity.name,
          role: identity.role,
          ...(identity.role === "engineer" ? { employeeId: identity.accountId.slice("employee:".length) } : {}),
        },
        shouldLinkViaEmail: false,
        shouldLinkViaPhone: false,
      });
      // Existing Convex Auth accounts skip the profile callback; check their
      // employee barrier too before issuing a new session.
      await ctx.runQuery(internal.employeeAccess.assertUserAccess, { userId: user._id });
      return { userId: user._id };
    },
  });
}

// Preview mode alone never enables the test provider. A preview test identity
// must be explicitly provisioned as server-only environment configuration.
const testAuthEnabled =
  process.env.VIKTOR_SPACES_IS_PREVIEW === "true" &&
  Boolean(process.env.VITROS_TEST_AUTH_EMAIL?.trim()) &&
  Boolean(process.env.VITROS_TEST_AUTH_PASSWORD_HASH?.trim());

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    VitrosRoleCredentials(),
    Password({
      verify: ViktorSpacesEmail,
      reset: ViktorSpacesPasswordReset,
    }),
    ...(testAuthEnabled ? [TestCredentials] : []),
  ],
  // Convex Auth applies this server-side to credential failures. It prevents
  // brute-force attempts without relying on browser timers/localStorage.
  signIn: {
    maxFailedAttempsPerHour: 6,
  },
  callbacks: {
    afterUserCreatedOrUpdated: async (ctx, args) => {
      if (args.provider.id !== "vitros-role") return;
      const role = args.profile.role;
      if (role !== "engineer" && role !== "superuser") {
        throw new Error("Invalid server-issued VITROS role");
      }
      const name = typeof args.profile.name === "string" ? args.profile.name.trim() : "";
      const employeeId = args.profile.employeeId;
      if (role === "engineer") {
        if (typeof employeeId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(employeeId)) {
          throw new Error("Invalid server-issued employee identity");
        }
        await assertEmployeeAccess(ctx, employeeId);
      }
      await ctx.db.patch(args.userId, {
        role,
        ...(role === "engineer" ? { employeeId: employeeId as string } : {}),
        ...(name ? { name } : {}),
      });
    },
  },
});

export const currentUser = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const user = await ctx.db.get(userId);
    if (!user) return null;
    return {
      _id: user._id,
      name: user.name ?? null,
      email: user.email ?? null,
      role: user.role ?? "viewer",
    };
  },
});
