# DHR / SAP Traceability Acceptance Requirements

## Purpose
Define the production acceptance criteria for DHR-driven inventory consumption, SAP staging, and user traceability across the VITROS dashboard.

## Core rules
- Every consumable part movement must be attributable to a user.
- User initials are required on DHR scan results, inventory transactions, audit history, and SAP staging rows.
- A single DHR may be worked by multiple authenticated users. Each movement keeps the initials of the user who performed that movement.
- DHR consumption updates Stock Summary immediately in real time. Finalize is a lifecycle/archive action only and does not trigger inventory consumption.
- Every DHR-driven consumable movement must also create a SAP staging row with pending status and the exact movement quantity.
- Quantity increases on a DHR produce an OUT movement and pending SAP row. Quantity decreases/revisions produce a compensating IN movement and corresponding SAP staging row.
- All stock transitions must use the atomic inventory transition path with correlation/idempotency, server-computed before/after quantities, audit creation, and SAP staging in the same authoritative transaction boundary where supported.

## DHR user traceability
Required visible/exported columns:
- User Initials
- User / Actor
- Revision
- Last Revised At

Initials must be derived from authenticated/server-resolved identity or validated employee mapping. Browser-local identity is not authoritative.

## SAP staging requirements
Required visible columns include:
- Part Number
- Description
- Movement
- Quantity
- User Initials
- User / Actor where available
- J# / Analyzer Job Identifier
- Date / Time
- Status

### J# field
Add a dedicated J# field to SAP staging. Example values:
- J76001234
- J56001234

The J# associated with the analyzer/DHR must be propagated from the DHR/session context into every SAP staging row created by DHR consumption or revision.

## SAP staging status
DHR-generated SAP rows must initially be `pending` and remain available for review before any ready/export/post workflow.

## SAP staging horizontal scrolling
The table header and table rows must be contained in the same horizontal scroll container and use the exact same column definition/min-width. Horizontal swiping/scrolling must move header and data together as one table. A static header with independently scrolling rows is not acceptable.

Acceptance check:
1. Populate enough columns to require horizontal scrolling on a narrow/mobile viewport.
2. Swipe left/right.
3. Header labels remain directly above their corresponding data cells for the entire scroll range.
4. No independent horizontal scroll position exists between header and body.

## Acceptance tests
1. User ABC changes a DHR consumable from 0 to 2. Stock Summary immediately decreases by 2; a pending SAP row is created for qty 2; initials ABC and the correct J# appear in DHR/audit/SAP records.
2. User XYZ later changes the same DHR part from 2 to 3. Stock decreases by exactly 1; a second pending SAP row is created for qty 1; that movement is attributed to XYZ, while the prior ABC movement remains immutable.
3. User ABC changes 3 to 1. Stock increases by 2; compensating SAP staging movement is created for qty 2 with ABC initials.
4. Two users consume different parts on the same DHR concurrently. Both changes persist, both stock updates are correct, and each SAP row carries the correct user's initials.
5. Finalizing the DHR changes lifecycle/archive state only and creates no duplicate inventory or SAP movement.
6. Reopening/revising a DHR preserves all prior user movement history.
7. SAP table horizontal scrolling keeps header and rows aligned at desktop and mobile widths.

## Required end markers
`DHR_STOCK_SYNC=PASS|FAIL`
`DHR_SAP_PENDING_SYNC=PASS|FAIL`
`USER_INITIALS_TRACEABILITY=PASS|FAIL`
`DHR_MULTIUSER_ATTRIBUTION=PASS|FAIL`
`SAP_J_NUMBER=PASS|FAIL`
`SAP_HEADER_ALIGNMENT=PASS|FAIL`
`BLOCKERS=<none or exact blocker>`
