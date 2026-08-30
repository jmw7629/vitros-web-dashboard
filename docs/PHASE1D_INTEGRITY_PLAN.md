# Phase 1D Integrity Plan

Corrections required before merge:

- reject non-positive inventory movement quantities
- reject OUT beyond QOH rather than clamp silently
- require admin for ADJUST and direct QOH changes
- remove generic privileged stock/user writes
- use configured SAP movement mapping including ADJUST=711
- replace audit-log-based idempotency with database-enforced atomic transition
- repair DHR session/result adapters
- fail closed on authenticated role resolution

This file tracks the direct recovery path while the OpenCode provider is rate-limited.
