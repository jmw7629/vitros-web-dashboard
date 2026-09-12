// A versioned employee change has one retry identity across reloads and tabs.
// Actor participates so an administrator cannot replay another actor's receipt.
export async function employeeOperationIdentity(
  actorId: string | undefined,
  id: string,
  action: "UPDATE" | "ACTIVATE" | "DEACTIVATE",
  expectedVersion: number,
  patch: { name?: string; initials?: string; active?: boolean } = {},
): Promise<string> {
  if (!actorId) throw new Error("Sign in before changing employees");
  const request = JSON.stringify([
    "employee-operation-v1", actorId, id.trim().toLowerCase(), action, expectedVersion,
    patch.name === undefined ? null : patch.name.trim(),
    patch.initials === undefined ? null : patch.initials.trim().toUpperCase(),
    patch.active ?? null,
  ]);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(request));
  return `employee:v1:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("")}`;
}
