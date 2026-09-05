import fs from "node:fs";

const auth = fs.readFileSync("convex/auth.ts", "utf8");
const testAuth = fs.readFileSync("convex/testAuth.ts", "utf8");
const seed = fs.readFileSync("convex/seedTestUser.ts", "utf8");

function requireInvariant(condition, message) {
  if (!condition) {
    console.error(`PREVIEW_TEST_AUTH_SECURITY=FAIL ${message}`);
    process.exit(1);
  }
}

requireInvariant(
  auth.includes('process.env.VIKTOR_SPACES_IS_PREVIEW === "true"') &&
    auth.includes("VITROS_TEST_AUTH_EMAIL") &&
    auth.includes("VITROS_TEST_AUTH_PASSWORD_HASH") &&
    auth.includes("testAuthEnabled ? [TestCredentials] : []"),
  "test provider must require preview mode plus server-configured identity and password hash",
);

requireInvariant(
  auth.includes("new Scrypt().verify(hash, secret)") &&
    !auth.includes("new Scrypt().verify(secret, hash)"),
  "superuser Scrypt verification must use hash then candidate secret",
);

requireInvariant(
  testAuth.includes("VITROS_TEST_AUTH_EMAIL") &&
    testAuth.includes("VITROS_TEST_AUTH_PASSWORD_HASH") &&
    testAuth.includes("email !== config.email") &&
    testAuth.includes("new Scrypt().verify(passwordHash, password)"),
  "preview test auth must allow only the configured identity after server-side hash verification",
);

requireInvariant(
  !/password\s*:\s*["'`][^"'`]+["'`]/.test(seed) &&
    !seed.includes("createAccount") &&
    !seed.includes("Scrypt"),
  "source-controlled test-user seeding must not contain reusable credentials or create accounts",
);

requireInvariant(
  !testAuth.includes("Only @test.local emails allowed") &&
    !/isTestEmail\s*\(/.test(testAuth),
  "arbitrary @test.local self-registration must remain removed",
);

console.log("PREVIEW_TEST_AUTH_SECURITY=PASS");
