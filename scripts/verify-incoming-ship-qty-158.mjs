const TARGET_SHA = "e555d602cc398b6c12d68131733843c757b92b41";
const ROOT = `https://raw.githubusercontent.com/jmw7629/vitros-web-dashboard/${TARGET_SHA}`;
const response = await fetch(`${ROOT}/convex/incomingStockActions.ts`, { cache: "no-store" });
if (!response.ok) throw new Error(`target fetch failed: ${response.status}`);
const source = await response.text();
for (const token of [
  'requireCapability(ctx, "inventory.write")',
  'requiresHumanConfirmation: true',
  'identityRule: "canonical_part_number_only"',
  'descriptionUsedForIdentity: false',
  'quantityRule: "ship_qty_preferred"',
  'obj.shippedQuantity ?? obj.shipped_quantity ?? obj.shipQty ?? obj.ship_qty ?? obj.qty ?? obj.quantity',
  'p_mode: "RECEIVE"',
  'const correlationId = `incoming:${args.confirmationId.trim()}`',
]) if (!source.includes(token)) throw new Error(`missing invariant: ${token}`);
for (const token of ['from("stock").update','from("audit_log").insert','from("sap_staging").insert','callerRole','callerUser']) {
  if (source.includes(token)) throw new Error(`forbidden invariant: ${token}`);
}
console.log(`VERIFY=PASS SHA=${TARGET_SHA} INCOMING_SHIP_QTY=PASS`);
