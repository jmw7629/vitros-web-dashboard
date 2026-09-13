# Digital DHR parts-consumption bridge

This implements the transport and inventory boundary from [issue 73](https://github.com/jmw7629/vitros-web-dashboard/issues/73). A controlled document renderer can submit explicitly bound quantity edits through the same inventory transaction used by the scanner. The bridge is disabled by default. It does not supply the missing controlled PDF, fabricate its field IDs, or replace its signatures, layout, non-part fields, and print workflow.

## Controlled binding and server authority

`src/lib/dhrDocumentContract.ts` defines the shared manifest, event, state and receipt types. A manifest binds a template/revision and exact artifact SHA-256 to unique field IDs, section IDs, controlled part numbers, consumable/tool kind and integer quantity mode. Multiple fields may contribute to the same part in a section. Descriptions are never lookup keys.

`register_digital_dhr_manifest` is a privileged database operation with a required registrar and review reference. It validates every binding against the existing expected-parts configuration. Templates are immutable: a different mapping cannot replace the same revision. No production manifest is seeded by the migration. The [machine-readable synthetic example](examples/digital-dhr-bindings.synthetic.json) is copied from `database/tests/dhr_document_bridge.sql`; its field IDs and repeated-letter artifact hash are fictional. Never register this example in production.

Document attachment requires an existing fresh scanner session with no scan-result rows, including zero-quantity rows. It records the immutable document/session relationship and pins the configured expected-part row and resolved inventory identity. Existing sessions are not adopted automatically. Later alias drift rejects the edit under lock; a return cannot move to a different stock item. The receipt distinguishes the controlled `partNumber` from `inventoryPartNumber` and `stockId` used for refreshing inventory.

The authenticated Convex action resolves the canonical user and employee ID. SQL rechecks an active employee with a name and initials in the transaction. Browser-authored actor names and initials are not accepted. Read and write actions require `inventory.read` and `inventory.write` respectively. New tables have RLS and no browser grants; RPC execution is service-role only. Manifests, instances and event receipts reject updates/deletes.

## Quantity and transaction semantics

Each event includes immutable UUID event/idempotency IDs, document/template/revision, field ID and next version, controlled section/part, previous and replacement integer quantity, instrument/work-order identity and occurrence time. A changed retry is a conflict. An exact committed retry returns its original receipt with `duplicate: true`.

| Accepted edit | Inventory movement |
| --- | --- |
| 0 → 2 | OUT 2 |
| 2 → 3 | OUT 1 |
| 3 → 1 | IN 2 |
| 0 → 0 | None |
| Tool quantity edit | None; receipt status `ignored`, delta 0 |
| Stale version, invalid quantity, unknown binding/part or insufficient stock | Rejected; no partial movement |

The server keeps each field's accepted contribution and the sum for each section/part. It verifies the tracked scanner quantity/revision still matches before calling the unchanged `apply_dhr_scan_transition` once with the replacement aggregate. Manual scanner changes produce a conflict instead of an overwrite. Stock, immutable inventory audit, pending SAP staging, scanner event, field state and document receipt commit together. A failure in the final receipt insert rolls all of them back. Production SAP transport is outside this bridge.

## Browser adapter integration

`IndexedDbDhrPendingStore` and `createDhrDocumentClient` provide the browser adapter independently of the renderer. Construction/import opens no database, starts no timers, and sends no requests. The default `enabled` callback is false. The renderer must obtain authenticated server state and explicitly call the client after a field edit.

The consuming application supplies these boundaries:

```ts
const scope = `${canonicalUserId}:${documentInstanceId}`;
const client = createDhrDocumentClient({
  store: new IndexedDbDhrPendingStore(),
  scope,
  // Read current identity and document from live application state each time.
  currentScope: () => session.currentScope,
  enabled: () => bridgeStatus.enabled === true,
  transport: (event) => applyFieldConsumption({ event }),
  getDocumentState: (id) => getDocumentState({ documentInstanceId: id }),
  afterAcknowledged: async (receipt) => {
    if (receipt.stockId && receipt.inventoryPartNumber) {
      await refreshInventory(receipt.stockId, receipt.inventoryPartNumber);
    }
    await refreshAcceptedDocument(receipt.documentInstanceId);
  },
});
```

The names in this sketch are application callbacks, not a new production renderer. `currentScope` must change to null on sign-out and to the new owner/document on a switch; a captured constant or a boolean signed-in flag is insufficient. Server identity remains authoritative. On an account switch, recreate the client for the new scope without deleting the original owner's pending edits.

Generate the event and idempotency IDs once for the edit, take previous quantity and version from accepted server state, and persist the exact event before sending it. `commit(event)` performs this sequence; `enqueue(event)` and `flush()` support explicit offline/reconnect controls. Show pending state until the matching receipt is durably acknowledged. An unknown response is retried with the original IDs, quantity and version. Cross-tab leases coordinate dispatch; server idempotency handles a response delayed beyond a lease. A refresh failure retains an acknowledged notification and retries refresh without consuming again.

The durable store caps outstanding events at 1,000 per scope and rejects overflow without dropping records. Only acknowledged notifications whose refresh succeeded are pruned. The server receipt ledger is the authoritative history. Browser storage failures and unavailable IndexedDB prevent dispatch. Browser storage can still be removed by the user or browser; the renderer must never suggest that clearing site data is a safe retry strategy for unconfirmed edits.

### Explicit conflict recovery

Expose `pending()` status and its safe failure message. Retry unknown results unchanged. For a definitive conflict, `reviewConflict(eventId)` fetches current authenticated state and returns the original edit plus accepted quantity/version for the user to review. Only after that review may the renderer call `resolveConflict(reviewId)`. It fetches again and retires only a still-conflicted event whose reviewed state is unchanged and whose version is already superseded on the server. It records durable resolution evidence, capped at 1,000 per scope without automatic eviction. A new user edit may then use the newly accepted version. It never invents a replacement quantity or submits it automatically.

If the accepted version is below the submitted version, including a manual scanner/aggregate conflict, local retirement is refused. Resolve the server discrepancy through the existing authorized reconciliation process. Unknown results, changed review evidence and a concurrent retry are retained rather than cleared.

## Rollout and verification

Both Convex environment variable `DIGITAL_DHR_ENABLED=true` and database setting `digitalDhrEnabled=true` are required for consumption. The migration inserts the setting as false if absent. `getBridgeStatus` reports the combined state; attachment and consumption enforce it independently. Keep flags false until the real artifact, reviewed manifest, matching server/browser deployment and authenticated acceptance are ready. Disabling either flag stops new digital consumption without removing pending edits or changing the manual scanner route/actions.

Deployment sequence:

1. Review the exact commit, pass CI and obtain its READY preview.
2. Apply the reviewed additive `20260913133922_dhr_document_field_bridge.sql` migration. Verify RLS, service-only grants, immutable triggers, empty manifests/events and default false setting. Do not replay older scanner migrations into production.
3. Release matching Convex code and browser adapter through the existing deployment/runtime gates. Restore required server-only credentials through the existing secret settings; never bypass the gate or put service credentials in the browser.
4. Verify the exact controlled artifact hash, its stable field IDs and approved part mappings, then register its reviewed manifest through the privileged boundary. No OCR or inferred field identifiers are an acceptable substitute.
5. Enable only the intended test environment and execute the full authenticated sequence, lost-response retry, conflict, two-user initials, resolved inventory lookup, finalization, scanner fallback and pending SAP checks. Record actual correlation/audit/SAP IDs in private acceptance evidence. Promote flags only after those checks succeed.

Automated evidence is scoped to synthetic boundaries:

- `node scripts/dhr-document-action-check.mjs` executes the registered action with controlled auth/provider boundaries: contract, capability, default-off, canonical actor, receipt matching, safe errors and metrics.
- `node scripts/dhr-document-client-check.mjs` executes the real queue/client against fake-indexeddb: durability, lease/retry, scope changes, receipt protocol, upgrades, bounds, refresh and explicit conflict recovery.
- `node scripts/dhr-document-browser-check.mjs` runs those production modules in Chromium's native IndexedDB with a loopback transport. It checks an actual page reload after a lost committed response, same-key retry, resolved-stock refresh, default-off behavior and account changes. Its report contains source hashes; this is browser storage evidence, not authenticated backend acceptance.
- The `dhr-document-database` CI job runs the exact existing inventory/scanner migrations and new bridge in a fresh PostgreSQL 17 database, followed by behavioral fixtures for deltas, aggregation, tool exclusion, alias drift, actor/replay, immutable history, grants and late-failure rollback. `scripts/dhr-document-database-check.mjs` is an optional local PGlite runner using a separately installed `@electric-sql/pglite` runtime.

Consumption attempts emit `digital_dhr_consumption` metrics with accepted/duplicate/rejected outcome, receipt status or a bounded error code, and elapsed milliseconds. They do not log the document, event payload, credentials or provider response. Use observed acceptance/replay/conflict/insufficient-stock/failure and latency to investigate rollout; synthetic test timing is not a live performance measurement.

The missing controlled PDF/manifest and authenticated staging/production acceptance remain explicit completion gates. Passing these fixtures does not establish exact PDF fidelity, successful production consumption, or `DIGITAL_DHR_STAGING_SMOKE=PASS`.
