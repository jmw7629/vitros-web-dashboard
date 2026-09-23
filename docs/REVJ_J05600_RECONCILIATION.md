# Rev-J J05600 section reconciliation — issue #433

## Scope
The one-shot migration `supabase/migrations/20260923084652_revj_j05600_section.sql` changes only the section of the single model5600/J05600/Filter, Air/required/BOM1 expected-part row from5.10 to5.12. It does not install a mutating reconciliation RPC. Original descriptions, IDs, category, BOM, aliases and other metadata stay unchanged. No scan results, sessions, stock, inventory operations, audit, SAP rows or immutable digital-document records are rewritten.

The control source already identifies field P040_TEXT_0243 in section5.12. This migration changes future configuration, not history. A result's status may be matched even when its owning session is deleted; the history guard therefore joins dhr_scan_sessions and checks the session status, never a fictitious result.deleted marker.

## Preconditions and rollout
Use the existing coordinator/review process. This candidate is NOT applied to Production. Preserve an authorized pre-change snapshot of the exact expected row and affected history before any reviewed application. Recheck current catalog and usage; stale preflight observations do not authorize application. A conflicting5.12 row, zero/multiple5.10 rows, wrong description/category/BOM, or relevant result whose owning session is not deleted aborts with a specific exception. Null session status also fails closed. One-shot replay deliberately fails because the source row no longer exists; deployment migration tracking must prevent reapplying it blindly.

Short table locks serialize the source count/history guard/update; a five-second lock timeout fails rather than waiting indefinitely. Perform this controlled configuration maintenance only when no competing DHR configuration/migration operation is active. Review dependencies on any currently attached digital documents before rollout; browser acceptance and owner-authorized application remain separate release gates. The migration requires the existing reviewed DHR schema and is not a general bootstrap.

The operator-only reverse is `database/rollbacks/20260923084652_revj_j05600_section.sql`. It requires exactly the corrected5.12 row, no conflicting5.10 row, and only deleted-session history in BOTH sections. It changes just section_id back to5.10. Never run a reverse automatically, change ledger history to make a guard pass, or downgrade a completed document revision.

## Executed acceptance
The driver reads the actual forward/reverse SQL files and executes their exact contents on disposable PostgreSQL. It does not call a substitute reconciliation function. Each scenario starts its own transaction and rolls back. The negative-test rejection sentinel is outside the exception handler; each expected failure also has a successful-NOOP mutation control and an unrelated-error propagation control.

Native PostgreSQL17.11, isolated container with no network/host port/data mount, passed39/39 assertions: exact one-field update; matched result in deleted session preserved; active/completed/null-session rejection; conflicting target; wrong description/category/BOM; missing/multiple source; rerun rejection; guarded reverse and reverse conflict/history rejection;12NOOP controls;12unrelated-error controls. It validates P040_TEXT_0243/5.12/J05600 with the actual validate_digital_dhr_manifest function after correction. Fourteen protected business/history tables and every expected-row field are compared. Post-suite fixture expected/session/result counts are zero.

The initial suite had a fixture UUID collision with the existing DHR regression seed. The fixture IDs were changed to a distinct valid UUID namespace; the original failure log is retained. That was a test-fixture failure, not a production defect or passing result.

CI runs `VITROS_DISPOSABLE_DATABASE=1 python3 scripts/revj-j05600-db-check.py` after the existing dhr_document_bridge test and before lifecycle tests, inside the existing disposable PostgreSQL17 job. Non-local/non-disposable database settings fail before SQL execution. The optional VITROS_QA_CONTAINER mode is for explicitly named local isolated fixture containers only; never use it for production containers.
