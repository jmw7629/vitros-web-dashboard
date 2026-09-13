import { Fragment, useEffect, useId, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Download, RefreshCw, Search } from "lucide-react";
import {
  useRemOperationalData,
  type RemOperationalDataset,
  type RemOperationalProduct,
  type RemOperationalRecord,
} from "../../hooks/useRemOperationalData";
import { Button } from "../ui/button";
import { theme, WebCard } from "./SharedComponents";

interface Column { key: string; label: string; format?: "money" | "percent"; }

const columns: Record<RemOperationalDataset, Column[]> = {
  field_status: [
    { key: "batch", label: "Batch" }, { key: "product", label: "Product" },
    { key: "status", label: "Status" }, { key: "release", label: "Release count" },
    { key: "releaseFpyPct", label: "Release FPY", format: "percent" },
    { key: "partsAtInstallUsd", label: "Parts at install", format: "money" },
    { key: "partsNotCertified", label: "Parts not certified" },
    { key: "partsAlsoCertified", label: "Parts also certified" },
  ],
  lvcc_reviews: [
    { key: "partNumber", label: "Part number" }, { key: "weekNumber", label: "Week" },
    { key: "weekStart", label: "Week start" }, { key: "recordedTotal", label: "Recorded total" },
    { key: "listedCount", label: "Listed IDs" }, { key: "totalDifference", label: "Listed − recorded" },
  ],
  install_parts: [
    { key: "serviceOrder", label: "Service order" }, { key: "equipmentNumber", label: "Equipment" },
    { key: "partNumber", label: "Part number" }, { key: "quantity", label: "Quantity" },
    { key: "costUsd", label: "Cost", format: "money" }, { key: "completedAt", label: "Completed" },
    { key: "productFamily", label: "Product family" }, { key: "country", label: "Country" },
  ],
  certified_parts: [
    { key: "serviceOrder", label: "Service order" }, { key: "equipmentNumber", label: "Equipment" },
    { key: "partNumber", label: "Part number" }, { key: "partLineNumber", label: "Part line" },
    { key: "laborLineNumber", label: "Labor line" }, { key: "lineType", label: "Line type" },
    { key: "quantity", label: "Quantity" }, { key: "partCostUsd", label: "Part cost", format: "money" },
    { key: "allCostUsd", label: "All cost", format: "money" },
  ],
  summary_targets: [
    { key: "product", label: "Product" }, { key: "quarter", label: "Quarter" },
    { key: "targetValue", label: "Summary target" }, { key: "annualTargetValue", label: "Annual target" },
    { key: "trackerPlanValue", label: "Tracker plan" }, { key: "planVariance", label: "Plan − target" },
  ],
};

const detailLabels: Record<string, string> = {
  orderReference: "Order reference", duplicateCount: "Duplicate count", postingDate: "Posting date",
  sourcePostingDate: "Posting date as recorded", yearMonth: "Year / month", cleanliness: "Cleanliness",
  cabinetry: "Cabinetry", buildQuality: "Build quality", finalLine: "Final line count",
  sourceReleaseFpy: "Release FPY as recorded", first90: "First 90", installDate: "Install date",
  sourceInstallDate: "Install date as recorded", comment: "Comment", fpyGoalPct: "FPY goal (%)",
  sourceFpyGoal: "FPY goal as recorded", sourceWeekStart: "Week start as recorded",
  sourceColumnD: "Source column D value", sourceColumnDLabel: "Source column D label",
  sourceColumnE: "Source column E value", sourceColumnELabel: "Source column E label",
  equipmentPartKey: "Equipment / part key", partCostUsd: "Part cost (USD)", allCostUsd: "All cost (USD)",
  sourceCompletedAt: "Completion date as recorded", sourceYearMonth: "Year / month as recorded",
  replacedInServiceKey: "Replaced in service key", region: "Region", problemCode: "Problem code",
  feedbackCode: "Feedback code", description: "Description", technicianCode: "Technician code",
  technicianName: "Technician", serviceMemo: "Service memo", resolutionMemo: "Resolution memo",
  serviceOrderFeedback: "Service order feedback", installFeedbackNotes: "Install feedback notes",
  internalComments: "Internal comments",
};

const extraFields: Record<RemOperationalDataset, string[]> = {
  field_status: ["orderReference", "duplicateCount", "postingDate", "sourcePostingDate", "yearMonth", "cleanliness", "cabinetry", "buildQuality", "finalLine", "sourceReleaseFpy", "first90", "installDate", "sourceInstallDate", "country", "comment", "fpyGoalPct", "sourceFpyGoal"],
  lvcc_reviews: ["sourceWeekStart", "sourceColumnD", "sourceColumnDLabel", "sourceColumnE", "sourceColumnELabel"],
  install_parts: ["equipmentPartKey", "yearMonth", "partCostUsd", "sourceCompletedAt", "sourceYearMonth", "replacedInServiceKey", "region", "problemCode", "feedbackCode", "description", "technicianCode", "technicianName", "serviceMemo", "resolutionMemo", "serviceOrderFeedback", "installFeedbackNotes", "internalComments"],
  certified_parts: ["equipmentPartKey", "yearMonth", "sourceYearMonth", "feedbackCode", "description"],
  summary_targets: [],
};

const descriptions: Record<RemOperationalDataset, string> = {
  field_status: "Recorded field measures by batch. Counts and FPY percentages remain separate measures.",
  lvcc_reviews: "Weekly review IDs and source totals. Listed IDs are counted separately from the recorded total.",
  install_parts: "Installation service lines with equipment, part, quantity and source costs.",
  certified_parts: "Individual certified service lines. Repeated equipment and part keys retain their separate line records.",
  summary_targets: "Summary quarterly targets and Tracker operating plans retain their separate source values.",
};

const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 });
const controlStyle = { color: theme.textPrimary, backgroundColor: theme.inputBg, borderColor: theme.cardBorder };

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function display(value: unknown, format?: Column["format"], precise = false): string {
  if (value === undefined || value === null || value === "") return "Blank";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "Blank";
    if (precise) return format === "money" ? `${value} USD` : format === "percent" ? `${value}%` : String(value);
    if (format === "money") return currency.format(value);
    if (format === "percent") return `${number.format(value)}%`;
    return number.format(value);
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return typeof value === "string" ? value : "See source details";
}

function RecordDetails({ record, fields }: { record: RemOperationalRecord; fields: Record<string, unknown> }) {
  const dataColumns = columns[record.dataset];
  const fieldsToShow: Column[] = [...dataColumns, ...extraFields[record.dataset].map((key) => ({ key, label: detailLabels[key] ?? key }))];
  const reviewIds = Array.isArray(fields.reviewIds) ? fields.reviewIds.map(object) : [];
  const numericSources = object(fields.sourceNumericText);
  return (
    <div className="space-y-4 p-4" style={{ backgroundColor: theme.inputBg }}>
      <div className="text-xs break-words" style={{ color: theme.textSecondary }}>
        <strong style={{ color: theme.textPrimary }}>Source: </strong>{record.sourceSheet} · Row {record.sourceRow}
        <span className="mt-1 block">Source key: {record.sourceKey}</span>
      </div>
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">
        {fieldsToShow.map((column) => (
          <div key={column.key} className="min-w-0">
            <dt className="text-[11px] font-semibold" style={{ color: theme.textSecondary }}>{column.label}</dt>
            <dd className="mt-0.5 whitespace-pre-wrap break-words text-xs" style={{ color: theme.textPrimary }}>{display(fields[column.key], column.format, true)}</dd>
          </div>
        ))}
      </dl>
      {record.dataset === "lvcc_reviews" && (
        <div>
          <h4 className="mb-2 text-xs font-bold" style={{ color: theme.textPrimary }}>Recorded review IDs</h4>
          {reviewIds.length === 0 ? <p className="text-xs" style={{ color: theme.textSecondary }}>No review IDs recorded in this row.</p> : (
            <table className="w-full text-left text-xs" aria-label="Review IDs and original cells">
              <thead><tr>{["Slot", "Review ID", "Source cell"].map((label) => <th key={label} scope="col" className="px-2 py-2" style={{ color: theme.textSecondary }}>{label}</th>)}</tr></thead>
              <tbody>{reviewIds.map((review, index) => <tr key={`${String(review.sourceCell)}-${index}`}>
                <th scope="row" className="px-2 py-1.5 font-normal">{display(review.slot)}</th>
                <td className="px-2 py-1.5 break-all">{display(review.value)}</td>
                <td className="px-2 py-1.5">{display(review.sourceCell)}</td>
              </tr>)}</tbody>
            </table>
          )}
        </div>
      )}
      {Object.keys(numericSources).length > 0 && (
        <div>
          <h4 className="mb-2 text-xs font-bold">Numeric text as recorded</h4>
          <dl className="grid gap-2 text-xs sm:grid-cols-2">{Object.entries(numericSources).map(([key, value]) => <div key={key}>
            <dt style={{ color: theme.textSecondary }}>{dataColumns.find((column) => column.key === key)?.label ?? detailLabels[key] ?? key}</dt>
            <dd className="break-words">{display(value)}</dd>
          </div>)}</dl>
        </div>
      )}
    </div>
  );
}

function RecordRow({ record }: { record: RemOperationalRecord }) {
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const fields = object(record.data);
  const rowColumns = columns[record.dataset];
  const rowLabel = display(fields[rowColumns[0].key]);
  return (
    <Fragment>
      <tr style={{ borderBottom: `1px solid ${theme.cardBorder}` }}>
        {rowColumns.map((column, index) => index === 0 ? (
          <th key={column.key} scope="row" className="whitespace-nowrap px-4 py-3 text-xs font-semibold">{display(fields[column.key], column.format)}</th>
        ) : <td key={column.key} className="max-w-64 px-4 py-3 text-xs break-words">{display(fields[column.key], column.format)}</td>)}
        <td className="px-3 py-2"><Button type="button" variant="ghost" size="sm" aria-expanded={expanded} aria-controls={detailsId} aria-label={`${expanded ? "Hide" : "Show"} source details for ${rowLabel}, row ${record.sourceRow}`} onClick={() => setExpanded((value) => !value)}>
          <ChevronDown aria-hidden="true" className={expanded ? "rotate-180" : ""} /> Details
        </Button></td>
      </tr>
      {expanded && <tr id={detailsId}><td colSpan={rowColumns.length + 1}><RecordDetails record={record} fields={fields} /></td></tr>}
    </Fragment>
  );
}

interface RemOperationalRecordsProps { dataset: RemOperationalDataset; title: string; initialQuery?: string; planYear?: number; }

function OperationalRecordsBody({ dataset, title, initialQuery = "", planYear }: RemOperationalRecordsProps) {
  const [draftQuery, setDraftQuery] = useState(initialQuery.slice(0, 160));
  const [query, setQuery] = useState(initialQuery.slice(0, 160));
  const [product, setProduct] = useState("");
  const [draftProduct, setDraftProduct] = useState("");
  const [offset, setOffset] = useState(0);
  const [limit, setLimit] = useState(50);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const id = useId();
  const scopedByYear = dataset !== "install_parts" && dataset !== "certified_parts";
  const [selectedYear, setSelectedYear] = useState(planYear ?? new Date().getFullYear());
  const effectiveYear = scopedByYear ? selectedYear : undefined;
  const data = useRemOperationalData({ dataset, planYear: effectiveYear, query, product: product || undefined, offset, limit });
  const searching = draftQuery.trim() !== query.trim() || (dataset === "install_parts" && draftProduct.trim() !== product.trim());
  const showProduct = dataset === "field_status" || dataset === "summary_targets";
  const productOptions: RemOperationalProduct[] = dataset === "field_status" ? ["VITROS", "VISION"] : ["VITROS", "VISION", "LVCC_ELECTROMETER", "LVCC_IR_WASH"];
  useEffect(() => {
    const timer = window.setTimeout(() => { setQuery(draftQuery); setOffset(0); }, 300);
    return () => window.clearTimeout(timer);
  }, [draftQuery]);
  useEffect(() => {
    if (dataset !== "install_parts") return;
    const timer = window.setTimeout(() => { setProduct(draftProduct); setOffset(0); }, 300);
    return () => window.clearTimeout(timer);
  }, [dataset, draftProduct]);

  const exportPage = async () => {
    setExporting(true);
    setExportError(null);
    const records = data.records;
    try {
      const [XLSX, { saveAs }] = await Promise.all([import("xlsx"), import("file-saver")]);
      const workbook = XLSX.utils.book_new();
      const values = records.map((record) => {
        const fields = object(record.data);
        const row: Record<string, string | number | boolean | null> = {
          dataset: record.dataset, sourceKey: record.sourceKey, sourceSheet: record.sourceSheet, sourceRow: record.sourceRow,
        };
        for (const [key, value] of Object.entries(fields)) {
          if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") row[key] = value;
        }
        return row;
      });
      // SheetJS serializes string values as text cells, including leading '='.
      // No imported value is used as an Excel formula or hyperlink.
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(values), "Source records");
      const reviews = records.flatMap((record) => {
        const ids = object(record.data).reviewIds;
        return Array.isArray(ids) ? ids.map((entry) => {
          const review = object(entry);
          return { sourceKey: record.sourceKey, sourceSheet: record.sourceSheet, sourceRow: record.sourceRow, slot: review.slot, reviewId: review.value, sourceCell: review.sourceCell };
        }) : [];
      });
      if (reviews.length) XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(reviews), "Review IDs");
      const numericText = records.flatMap((record) => Object.entries(object(object(record.data).sourceNumericText)).map(([field, value]) => ({
        sourceKey: record.sourceKey, sourceSheet: record.sourceSheet, sourceRow: record.sourceRow, field, recordedText: String(value),
      })));
      if (numericText.length) XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(numericText), "Recorded numeric text");
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
        ["Scope", "Current displayed page only"], ["Dataset", dataset], ["Plan year", effectiveYear ?? "Historical service lines, across all plan years"],
        ["Search", query], ["Product filter", product || "All"], ["Matching records", data.total],
        ["Rows exported", records.length], ["Page", Math.floor(offset / limit) + 1],
        ["Loaded at", data.loadedAt === null ? "" : new Date(data.loadedAt).toISOString()],
      ]), "Export context");
      saveAs(new Blob([XLSX.write(workbook, { type: "array", bookType: "xlsx" })], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
        `REM_${dataset}${effectiveYear ? `_${effectiveYear}` : ""}_page_${Math.floor(offset / limit) + 1}.xlsx`);
    } catch {
      setExportError("This page could not be exported. Please try Export page again.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <WebCard className="min-w-0 overflow-hidden">
      <section aria-labelledby={`${id}-heading`} style={{ color: theme.textPrimary }}>
        <div className="space-y-3 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h3 id={`${id}-heading`} className="text-sm font-bold">{title}</h3>
              <p className="mt-1 text-xs" style={{ color: theme.textSecondary }}>{descriptions[dataset]}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" style={controlStyle} disabled={exporting || searching || data.isLoading || Boolean(data.error) || data.records.length === 0} onClick={() => void exportPage()}><Download aria-hidden="true" /> {exporting ? "Exporting…" : "Export page"}</Button>
              <Button type="button" size="sm" variant="outline" style={controlStyle} disabled={data.isLoading || !data.isAuthenticated} onClick={data.refresh} aria-label={`Refresh ${title}`}><RefreshCw aria-hidden="true" className={data.isLoading ? "animate-spin motion-reduce:animate-none" : ""} /> Refresh</Button>
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            {scopedByYear && <label htmlFor={`${id}-year`} className="text-[11px] font-semibold" style={{ color: theme.textSecondary }}>Plan year
              <select id={`${id}-year`} value={selectedYear} disabled={planYear !== undefined} onChange={(event) => { setSelectedYear(Number(event.target.value)); setOffset(0); }} className="mt-1 block h-9 rounded-lg border px-3 text-xs" style={controlStyle}>
                {Array.from({ length: 81 }, (_, index) => 2020 + index).map((year) => <option key={year} value={year}>{year}</option>)}
              </select>
            </label>}
            <label htmlFor={`${id}-search`} className="min-w-48 flex-1 text-[11px] font-semibold" style={{ color: theme.textSecondary }}>Search source records
              <span className="relative mt-1 block"><Search aria-hidden="true" className="absolute left-3 top-2.5 h-4 w-4" />
                <input id={`${id}-search`} type="search" maxLength={160} value={draftQuery} onChange={(event) => setDraftQuery(event.target.value)} placeholder="Batch, part or service order" className="h-9 w-full rounded-lg border pl-9 pr-3 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2" style={controlStyle} />
              </span>
            </label>
            {showProduct && <label htmlFor={`${id}-product`} className="text-[11px] font-semibold" style={{ color: theme.textSecondary }}>Product
              <select id={`${id}-product`} value={product} onChange={(event) => { setProduct(event.target.value); setOffset(0); }} className="mt-1 block h-9 max-w-full rounded-lg border px-3 text-xs" style={controlStyle}>
                <option value="">All products</option>{productOptions.map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}
              </select>
            </label>}
            {dataset === "install_parts" && <label htmlFor={`${id}-family`} className="text-[11px] font-semibold" style={{ color: theme.textSecondary }}>Exact product family
              <input id={`${id}-family`} type="search" maxLength={80} value={draftProduct} onChange={(event) => setDraftProduct(event.target.value)} placeholder="Source product family" className="mt-1 block h-9 max-w-full rounded-lg border px-3 text-xs" style={controlStyle} />
            </label>}
            <label htmlFor={`${id}-limit`} className="text-[11px] font-semibold" style={{ color: theme.textSecondary }}>Rows
              <select id={`${id}-limit`} value={limit} onChange={(event) => { setLimit(Number(event.target.value)); setOffset(0); }} className="mt-1 block h-9 rounded-lg border px-3 text-xs" style={controlStyle}>{[25, 50, 100].map((value) => <option key={value} value={value}>{value}</option>)}</select>
            </label>
          </div>
          {data.error && <div role="alert" className="rounded-lg border p-3 text-xs" style={{ borderColor: theme.statusOut }}>
            <p>{data.error} {data.loadedAt !== null ? "Previously loaded records remain visible." : ""}</p>
            <Button type="button" variant="outline" size="sm" className="mt-2" style={controlStyle} disabled={data.isLoading} onClick={data.refresh}>Retry</Button>
          </div>}
          {exportError && <p role="alert" className="text-xs" style={{ color: theme.statusOut }}>{exportError}</p>}
          <p role="status" aria-live="polite" className="text-xs" style={{ color: theme.textSecondary }}>
            {searching ? "Waiting for search…" : data.isLoading ? "Loading source records…" : !data.isAuthenticated ? "Sign in to view REM source records." : data.loadedAt === null ? "Source records are unavailable." : `${data.total.toLocaleString()} matching records · ${data.records.length ? `${offset + 1}–${offset + data.records.length}` : "0"} shown`}
          </p>
        </div>
        {data.records.length > 0 && <div className="max-h-[36rem] overflow-auto" role="region" aria-label={`${title} scrollable table`} tabIndex={0} aria-busy={data.isLoading}>
          <table className="w-full min-w-[850px] border-collapse text-left">
            <caption className="sr-only">{title}. Blank indicates an unrecorded source value. Expand a row for source sheet, row and recorded details.</caption>
            <thead className="sticky top-0 z-10" style={{ backgroundColor: theme.cardBg }}><tr>
              {columns[dataset].map((column) => <th key={column.key} scope="col" className="whitespace-nowrap px-4 py-3 text-[10px] font-bold uppercase tracking-wide" style={{ color: theme.textSecondary, borderBottom: `1px solid ${theme.cardBorder}` }}>{column.label}</th>)}
              <th scope="col" className="px-3 py-3 text-[10px] font-bold uppercase" style={{ color: theme.textSecondary }}>Source</th>
            </tr></thead>
            <tbody>{data.records.map((record) => <RecordRow key={`${record.dataset}:${record.sourceKey}`} record={record} />)}</tbody>
          </table>
        </div>}
        {!data.isLoading && !data.error && data.isAuthenticated && data.records.length === 0 && <div className="px-4 pb-6 text-sm" style={{ color: theme.textSecondary }}>{query || product ? "No source records match these filters." : offset > 0 ? "This page is empty. Return to the previous page." : "No source records have been imported for this dataset."}</div>}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3" style={{ borderColor: theme.cardBorder }}>
          <span className="text-[11px]" style={{ color: theme.textSecondary }}>Blank = unrecorded · Source values are preserved</span>
          <nav aria-label={`${title} pagination`} className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" style={controlStyle} disabled={offset === 0 || data.isLoading || searching || !data.isAuthenticated} onClick={() => setOffset((value) => Math.max(0, value - limit))}><ChevronLeft aria-hidden="true" /> Previous</Button>
            <span className="text-xs">Page {Math.floor(offset / limit) + 1}</span>
            <Button type="button" variant="outline" size="sm" style={controlStyle} disabled={!data.hasMore || data.isLoading || searching || Boolean(data.error)} onClick={() => setOffset((value) => value + limit)}>Next <ChevronRight aria-hidden="true" /></Button>
          </nav>
        </div>
      </section>
    </WebCard>
  );
}

export function RemOperationalRecords(props: RemOperationalRecordsProps) {
  return <OperationalRecordsBody key={`${props.dataset}:${props.planYear ?? ""}:${props.initialQuery ?? ""}`} {...props} />;
}
