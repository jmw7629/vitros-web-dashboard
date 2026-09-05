import { ConvexCredentials } from "@convex-dev/auth/providers/ConvexCredentials";
import { createAccount, retrieveAccount } from "@convex-dev/auth/server";
import { Scrypt } from "lucia";
import type { DataModel } from "./_generated/dataModel";

declare const process: { env: Record<string, string | undefined> };

const TEST_EMAIL_DOMAIN = "test.local";

function testAuthConfig(): { email: string; passwordHash: string } {
  const email = process.env.VITROS_TEST_AUTH_EMAIL?.trim().toLowerCase() ?? "";
  const passwordHash = process.env.VITROS_TEST_AUTH_PASSWORD_HASH?.trim() ?? "";

  if (!email || !email.endsWith(`@${TEST_EMAIL_DOMAIN}`) || !passwordHash) {
    throw new Error("Test authentication is disabled");
  }

  return { email, passwordHash };
}

async function verifyConfiguredTestCredential(password: string, passwordHash: string): Promise<boolean> {
  if (!password || password.length > 256) return false;
  try {
    return await new Scrypt().verify(password, passwordHash);
  } catch {
    return false;
  }
}

export const TestCredentials = ConvexCredentials<DataModel>({
  id: "test",
  crypto: {
    async hashSecret(password: string) {
      return await new Scrypt().hash(password);
    },
    async verifySecret(password: string, hash: string) {
      return await new Scrypt().verify(hash, password);
    },
  },
  authorize: async (params, ctx) => {
    const email = typeof params.email === "string" ? params.email.trim().toLowerCase() : "";
    const password = typeof params.password === "string" ? params.password : "";
    const flow = typeof params.flow === "string" ? params.flow : "";
    const config = testAuthConfig();

    if (email !== config.email) {
      throw new Error("Test authentication failed");
    }

    if (!(await verifyConfiguredTestCredential(password, config.passwordHash))) {
      throw new Error("Test authentication failed");
    }

    if (flow === "signUp") {
      try {
        const existing = await retrieveAccount(ctx, {
          provider: "test",
          account: {
            id: email,
            secret: password,
          },
        });
        return { userId: existing.user._id };
      } catch {
        // The configured preview identity does not exist yet; create only that identity.
      }

      const { user } = await createAccount(ctx, {
        provider: "test",
        account: {
          id: email,
          secret: password,
        },
        profile: {
          email,
          name: "Preview Test User",
          emailVerificationTime: Date.now(),
        },
        shouldLinkViaEmail: false,
      });

      return { userId: user._id };
    }

    const result = await retrieveAccount(ctx, {
      provider: "test",
      account: {
        id: email,
        secret: password,
      },
    });

    return { userId: result.user._id };
  },
});
