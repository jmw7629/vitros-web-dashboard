# Enterprise Uploads

Server-authoritative intake for arbitrary business files (XLSX/CSV/TSV/JSON/HTML/XML/text)
with review, AI-assisted mapping proposals, and publication as **reporting snapshots**.
Published datasets never mutate stock, SAP staging, DHR records, or live work data.

## Scope

- `convex/enterpriseFileParser.ts` — pure parsing: workbooks (incl. hidden sheets/rows/columns,
  merged regions, formulas with cached values), delimited text (incl. UTF-16), JSON, HTML tables.
  Formulas are never executed. Uncached formulas (`t:"z"`) and error cells (`t:"e"`, numeric
  error codes like `0x2A`) are flagged for review and never counted as zero.
- `convex/enterpriseMapping.ts` — pure mapping: header inference, numeric/date parsing,
  AI-suggestion guardrails (AI classifies existing columns only; it cannot add, drop, rename,
  or invent values). Ambiguous separators (`1,234.50` vs `1.234,50`) are only parsed under an
  explicit `us`/`eu` number format; leading-zero text identifiers (`00123`) are never coerced.
- `convex/enterpriseUploads.ts` — upload lifecycle: begin (idempotent by actor+correlationId),
  attach (one retained original), queue (10-minute analysis lease, generation-guarded),
  markParsing/finish (stale generations rejected), publishInternal (revision-checked,
  idempotent replay, before/after audit).
- `convex/enterpriseUploadActions.ts` — node actions: process (parse + rule-based suggestions +
  free-Zen mapping proposals over bounded samples), table (paginated review), publish
  (refuses `needs_attention` sources), dataset (destination-gated reads: inventory→`inventory.read`,
  production→`rem.read`).
- `convex/enterpriseUploadSchema.ts` + `convex/schema.ts` spread — additive tables
  `enterpriseUploads`, `enterpriseDatasets`, `enterpriseUploadAudit`.

RBAC: all mutations/reads require server capabilities (`admin.system_settings.manage` for the
pipeline; `inventory.read`+`rem.read` for snapshot listing). Anonymous reads/writes are denied.

## Limits

- 32 MB file cap; 50,000 populated rows / 500,000 cells / 2,048 columns / 256 sheets per workbook.
- PDFs/images are not parsed in this path (use PDF/image text recovery and attach the
  extracted text, or upload a converted spreadsheet/text copy).
- AI mapping requires a configured free Zen key; without it, rule-based suggestions and
  manual mapping remain fully available (no paid fallback).
- Published snapshots are point-in-time reports, not live inventory.

## Manual recovery

- Every failure path retains the original file: re-queue analysis, attach recovery text
  (`attachText`, ≤2 MB), or upload a smaller converted copy via a new correlated `begin`.
- Incomplete/damaged archives are kept with a `needs_attention` message; nothing is discarded.
- Empty JSON (no data records) is flagged `needs_attention` with a no-data warning.

## Deployment

Additive only: new Convex modules + schema tables. Deploy after green checks:

```sh
CONVEX_DEPLOYMENT=prod:youthful-cat-318 npx convex deploy --yes
```

Verify: anonymous public reads/writes denied; authenticated Engineer reads datasets;
existing server role flow unchanged; no production fixtures inserted.

## Verification

```sh
node --experimental-strip-types scripts/enterprise-file-parser-check.mjs
node scripts/enterprise-upload-check.mjs
node scripts/enterprise-upload-flow-check.mjs
npm run typecheck
npm run build
git diff --check
```

Expected (2026-09-17): parser 142, upload 88, flow 37 — 267 assertions, 0 failures.
Also gated by `.github/workflows/enterprise-uploads.yml` on PRs touching this slice.
