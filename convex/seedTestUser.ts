import { v } from "convex/values";
import { internalAction } from "./_generated/server";

// Source-controlled test credentials are intentionally forbidden. Preview test
// identities must be provisioned through reviewed server-side environment
// configuration instead of embedding reusable passwords in repository history.
export const seedTestUser = internalAction({
  args: {},
  returns: v.object({
    success: v.boolean(),
    message: v.string(),
  }),
  handler: async () => {
    return {
      success: false,
      message: "Test-user seeding is disabled; use server-configured preview test auth.",
    };
  },
});
