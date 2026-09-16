export interface KitDemandLine {
  partNumber: string;
  description: string;
  qtyRequired: number;
  module?: string;
  sourceLine?: string;
  quantityLabel?: string;
  requiresManualQuantity?: boolean;
}

export function getKitDemand(
  components: KitDemandLine[],
  manualQuantities: Record<string, string> = {},
) {
  const totals = new Map<string, number>();
  const unresolved: number[] = [];
  const lines = components.map((line, index) => {
    const raw = line.requiresManualQuantity ? manualQuantities[line.partNumber] : line.qtyRequired;
    const quantity = raw === undefined || raw === "" ? NaN : Number(raw);
    const valid = Number.isSafeInteger(quantity) && (line.requiresManualQuantity ? quantity >= 0 : quantity > 0);
    if (!valid) unresolved.push(index);
    if (valid && quantity > 0) totals.set(line.partNumber, (totals.get(line.partNumber) ?? 0) + quantity);
    return { ...line, resolvedQuantity: valid ? quantity : null };
  });
  const parts = [...totals].map(([partNumber, qtyRequired]) => ({
    partNumber,
    qtyRequired,
    description: components.find(line => line.partNumber === partNumber)?.description ?? "",
  }));
  return { lines, parts, totals, unresolved };
}

export function kitPartQuantity(components: KitDemandLine[], partNumber: string): string {
  const matching = components.filter(line => line.partNumber === partNumber);
  if (matching.some(line => line.requiresManualQuantity)) {
    return matching.map(line => line.quantityLabel || "Enter quantity").join(" + ");
  }
  return String(matching.reduce((total, line) => total + line.qtyRequired, 0));
}
