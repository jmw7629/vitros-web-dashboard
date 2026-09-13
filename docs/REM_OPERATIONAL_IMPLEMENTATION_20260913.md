# REM operational workbook implementation — 2026-09-13

This change extends the existing authenticated REM import with Field Status VITROS/VISION, LVCC DHR Reviews, Install Parts, Certified Parts, and Summary targets. It preserves the existing core parser and transactional core RPC. The prior Field Status page substituted completed WIP analyzers; it now shows actual imported source records.

## Import and read behavior

The browser validates the entire workbook before any staging begins, then uploads operational records in bounded batches of 250. The authenticated server binds staging to the canonical actor and checks source keys, values, dates, provenance, row bounds, sequence, and replay hashes. Server-confirmed progress supports lost-response recovery without storing workbook records in browser local storage.

One final database transaction applies core data, merges operational records, and appends immutable import/audit events. A late operational failure rolls back the core import too. Omitted records are preserved. Conflicting retries fail; identical retries return the committed receipt. Staging is hidden from operational reads. Browser roles cannot write the new tables or execute their RPCs; Convex capability checks guard the service boundary.

Parts history uses stable service-line identity across workbook years. Annual field, review and target views have explicit year selection. Source blanks, recorded numeric text, counts versus percentages, recorded versus listed review totals, and differing Summary/Tracker plans retain distinct meanings. Paginated tables offer search, product filtering, source details, refresh, and export of the displayed page with provenance and export context.

The raw file hash and year identify a staged interpretation under this release's fixed parser contract. Future changes to record identity or interpretation require an explicit contract migration/version decision before reusing existing imports.

## Verification scope

- Production parser acceptance covers synthetic schemas, malformed inputs, formula cache integrity, exact SCRAP exclusions, stable history keys, source footer reconciliation, and both privately recovered workbooks.
- All 25,388 operational records from each recovered workbook pass the actual server validators. This does not establish full workbook readiness: the core parser correctly rejects their corrupt Tracker formulas.
- Actual React hook/component tests cover stale-response races, sign-out cleanup, paging, year scoping, search, source details, and spreadsheet export. These are controlled boundary tests, not live authenticated browser evidence.
- Full frontend and Convex TypeScript checks and the Vite production build pass in an isolated VPS verification worktree using the existing locked dependencies. The build retains existing large-bundle warnings; no deployment is implied by this local build.
- Disposable database fixtures execute the existing core migration and new migration together. They verify bounded staging, actor binding, conflict/replay handling, rollback, immutable audit, provenance merge behavior, and pagination. A separate fresh PostgreSQL 17 CI job runs the same SQL fixtures.
- The private scale check stages 25,388 rows in 102 batches and finalizes through the exact core RPC with synthetic core fixtures in disposable PGlite. Its timing is not a native Supabase performance claim. See the [deployment checks](RUNBOOK.md#full-rem-workbook-import-deployment-checks-2026-09-13) for the scoped RPC timeout prerequisite.

## Remaining completion gates

1. Independent review of the exact commit, normal CI, and a READY Vercel preview precede merge. Apply only the reviewed migration and matching server/browser release in the documented order.
2. Restore valid server-only Production credentials in the existing Vercel project. The reviewed-main production build inspected during this continuation failed at missing `SUPABASE_SERVICE_ROLE_KEY`; `OPENAI_API_KEY` readiness is unverified. No deployment gate was bypassed.
3. Obtain a corrected workbook, repair its intended Tracker/Build Plan week references, recalculate/save, and pass the full preview. The original copies remain untouched. See [source integrity evidence](REM_WORKBOOK_SOURCE_INTEGRITY.md).
4. Recover the exact controlled Rev J fillable PDF and its field manifest. The recovered original DOCX cannot establish the prior controlled PDF's exact field IDs or print fidelity. Full digital checklist bindings and exact print acceptance remain pending.
5. Run authenticated production acceptance after deployment: workbook import and replay, cross-session reads and measured propagation, fresh DHR quantity transitions and retry/reversal/finalization with correlated immutable events, multi-user initials and J-number lookup, and pending SAP staging. No production SAP posting is authorized by this change.

This implementation does not mark the overall REM/DHR project complete or claim production business-data acceptance.
