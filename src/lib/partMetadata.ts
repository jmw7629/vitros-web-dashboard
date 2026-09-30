import type { StockSummaryColumnConfig, PartMasterFieldConfig } from "./configRegistry";
export const METADATA_FIELDS = [
  { key: "supportedModels", label: "Models" }, { key: "module", label: "Subassembly" },
  { key: "subassemblyCodes", label: "Subcode" }, { key: "systemSide", label: "Dry / Wet" },
  { key: "qtyUsed5600", label: "Qty / 5600" }, { key: "qtyUsed7600", label: "Qty / 7600" },
  { key: "qtyUsed3600", label: "Qty / 3600" }, { key: "bomSection", label: "Section" },
];
export function normalizePartColumns<T extends StockSummaryColumnConfig | PartMasterFieldConfig>(input: T[]): T[] {
  const result = input.filter(c => c.key !== "binLocation").map(c => ({ ...c, label: c.key === "module" && c.label === "Module" ? "Subassembly" : c.label })).sort((a,b) => a.order-b.order);
  for (const field of METADATA_FIELDS) if (!result.some(c => c.key === field.key)) {
    result.push({ ...field, visible: true, order: result.length } as T);
  }
  return result.map((c,order) => ({ ...c, order }));
}
export function metadataList(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((v): v is string => typeof v === "string" && !!v.trim()).map(v => v.trim()))] : [];
}
export function listDisplay(value: unknown): string { return metadataList(value).join(" / ") || "Not verified"; }
export function partSearchText(p: {partNumber?:string;description?:string;module?:string;supportedModels?:string[];subassemblyCodes?:string[];systemSide?:string}): string {
 return [p.partNumber,p.description,p.module,...metadataList(p.supportedModels),...metadataList(p.subassemblyCodes),p.systemSide,(p as any).bomSection].filter(Boolean).join(" ").toLowerCase();
}
export function csvCell(value: unknown): string {
 let text=String(value ?? "");
 if(typeof value === "string" && /^[\s]*[=+@-]/.test(text)) text="'"+text;
 return '"'+text.replace(/"/g,'""')+'"';
}
export function stockCsv(parts: Array<Record<string, any>>): string {
 const headers=["Part #","Description","Models","Subassembly","Subcode","Dry / Wet","Qty / 5600","Qty / 7600","Qty / 3600","Section","Type","QOH","Min","Max","Status","On Plan"];
 const rows=parts.map(p=>[p.partNumber,p.description,listDisplay(p.supportedModels),p.module||"Not verified",listDisplay(p.subassemblyCodes),p.systemSide||"Not mapped",p.qtyUsed5600??0,p.qtyUsed7600??0,p.qtyUsed3600??0,p.bomSection||"",p.type,p.qoh,p.minQty,p.maxQty,p.qoh===0?"STOCKOUT":p.minQty>0&&p.qoh<p.minQty?"LOW":"OK",p.onPlan?"Yes":"No"]);
 return [headers,...rows].map(row=>row.map(csvCell).join(",")).join(String.fromCharCode(13, 10));
}
export function parseMetadataList(value: string): string[] { return [...new Set(value.split(/[;/]/).map(v=>v.trim()).filter(Boolean))]; }
