# Incoming Stock confirmation and retry repair — issue70

## Reproduced defects and bounded change
The independent actual-component/action harness at main672c526 reproduced six failures in three clusters: image/PDF queued-row changes were ignored by the captured receive loop, a changed document header re-keyed an unacknowledged retry, and separately appended manual lines shared one physical-line identity. The original15-case harness passed9/failed6 before this repair. Original failure evidence is retained outside source.

Both image and PDF paths now guard review and confirmation synchronously, so repeated/captured callbacks cannot dispatch overlapping batches. The entire confirmed batch's selection/edit/removal controls are frozen while it is running. Handler-level guards protect previously captured callbacks, not only button styling. A queued row that was confirmed remains in that explicit batch; a visibly enabled cancellation is never silently ignored.

Reviewed lines retain their document reference. Before the first attempt, a changed normalized reference invalidates review and selection. Image lines must be re-reviewed; PDF lines require the PDF to be reviewed again under the new reference. A missing reference cannot be confirmed. Normalization is the same uppercase/trim/space-collapse identity already used by the backend.

At first dispatch each line stores its exact immutable request in an in-memory ref. Unacknowledged retries use that request, not the current header or editable line state. After any receipt attempt, a different document reference is refused with reconciliation guidance; attempted lines cannot be edited, removed or re-reviewed into a new material request. PDF replacement is also blocked for an attempted receipt. This does NOT implement persistent recovery across a reload, discarded modal or another device: those remain separate operational acceptance/reconciliation concerns. Do not claim the ref map is durable storage.

Manual lines use the explicit MANUAL page namespace and a monotonic source-line sequence within the current receipt workspace, capped at the backend's500-line limit. Correction/re-review carries existing page/line identity. No random presentation ID becomes authoritative, no server correlation format changes, and no existing record is migrated.

## Preserved boundaries
No SQL/backend/auth/RLS/OCR provider or SAP-posting code changes. Actual stock matching remains normalized part number only; the server resolves actor and computes atomic RECEIVE/audit/pending-SAP. Existing DHR/scanner/REM/UI identity remains unchanged. Reviewed or generated fixture content is never inserted into Production.

## Executed tests
The candidate passes the unchanged independent15-case reproducer, plus3 implemented regression cases for duplicate image/PDF confirmation callbacks and captured queued selection/removal/edit handlers:18/18 actual React/action cases. Auth/OCR/HTTP/RPC boundaries are synthetic, not native-browser/provider/database acceptance. The adapted test runs in the existing Completion Regression job. The former verifier authorship is retained; this implementer run is not independent approval.

Six existing receiving/security scripts pass, including17acceptance fixture groups and20deterministic-identity tests; structural checks do not replace the executable UI cases. App/Node/Convex typechecking and an offline Vite build pass with synthetic public URLs and network denial. Existing renderer deprecation and bundle warnings remain in logs.

One attempted optional extra-test append was blocked before execution. It was not retried through another path; those exact additional test proposals are not included or counted. The three already-written extra cases ran successfully. No screenshot or browser pass is claimed. Exact-head CI and independent review are still required before merge/deploy; actual receipt reconciliation, representative packing-slip OCR and reversible Production RECEIVE remain live acceptance gates.
