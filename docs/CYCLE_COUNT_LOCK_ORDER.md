# Cycle Count and DHR transaction ordering

Cycle Count confirmation freezes DHR sessions before reading WIP and before
locking stock. It now takes an `EXCLUSIVE` table lock instead of `SHARE`.
DHR lifecycle updates first take `SELECT ... FOR UPDATE` (a `ROW SHARE` table
lock), then execute `UPDATE` (a `ROW EXCLUSIVE` table lock). Previously the count
could acquire `SHARE`, wait for the DHR row, and prevent that DHR transaction
from upgrading its table lock. PostgreSQL then aborted one transaction with
`40P01`.

`EXCLUSIVE` conflicts with the initial DHR row-locking table mode, so confirmation
waits before acquiring its snapshot. Ordinary SELECT readers remain concurrent.
The existing DHR-before-stock order, WIP fingerprint rejection, stock tokens,
revision checks, atomic inventory adjustment and immutable receipts remain.
Concurrent confirmations on different schedules serialize during confirmation;
no lock is held while a user enters or reviews their count.

The forward migration replaces only `apply_cycle_count_operation`'s lock mode
and explanatory comment, retaining its invoker privileges and execution grants.
It changes no business rows. If operational rollback becomes necessary, pause
confirmation and diagnose lock waits; do not restore the known deadlocking
SHARE mode or split the atomic operation. Existing requests can retry with their
original correlation IDs after transaction rollback or completion.

Verification on 2026-09-23 used an isolated PostgreSQL 18.1 database with the
production atomic inventory, DHR and Cycle Count migrations. The existing SQL
regression passed. `scripts/cycle-count-concurrency-check.cjs` uses two contending
connections and an observer to establish both arrival orders through actual
RPCs, without timing sleeps as the synchronization condition:

- DHR holds its row first: lifecycle completes; count rejects changed WIP and
  leaves stock and count revision unchanged.
- Count confirms first: DHR waits until count commits; ordinary readers remain
  available; inventory reaches the counted quantity with one audit and pending
  SAP staging record, including after exact replay.

The same regression against the original migration fails with `40P01`, proving
it detects the defect. CI repeats the tests on PostgreSQL 17. These are disposable
database results, not production concurrency or browser acceptance evidence.
