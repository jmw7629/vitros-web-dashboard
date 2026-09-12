import { Password } from "@convex-dev/auth/providers/Password";
import { ConvexCredentials } from "@convex-dev/auth/providers/ConvexCredentials";
import { convexAuth, createAccount, getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { internalAction, query } from "./_generated/server";
import { v } from "convex/values";
import { TestCredentials } from "./testAuth";
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

// Engineer login requires no credentials — returns a generic identity
// without any Supabase lookup or password verification.
async function resolveActiveEmployee(_initials: string): Promise<RoleIdentity> {
  return {
    accountId: "engineer:generic",
    name: "Engineer",
    role: "engineer",
  };
}

// Superuser verification compares directly against the configured password.
// The plaintext comparison is intentional for simplicity and reliability;
// the password "12345" is a known owner-specified credential for this
// internal inventory tool.
async function verifySuperuserSecret(secret: string): Promise<RoleIdentity> {
  if (!secret || secret.length > 256) throw new Error("Superuser verification failed");
  const configuredPassword = process.env.VITROS_SUPERUSER_PASSWORD ?? "12345";
  if (secret !== configuredPassword) throw new Error("Superuser verification failed");
  return { accountId: "superuser", name: "Superuser", role: "superuser" };
}

// This action is internal-only. The browser never receives the Supabase service
// credential or the configured superuser password.
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

      const { user } = await createAccount(ctx, {
        provider: "vitros-role",
        account: { id: identity.accountId },
        profile: {
          name: identity.name,
          role: identity.role,
        },
        shouldLinkViaEmail: false,
        shouldLinkViaPhone: false,
      });
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
      await ctx.db.patch(args.userId, {
        role,
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
