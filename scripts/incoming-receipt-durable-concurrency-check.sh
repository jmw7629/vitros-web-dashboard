#!/usr/bin/env bash
set -euo pipefail

if [[ "${VITROS_DISPOSABLE_DATABASE:-}" != "1" ]]; then
  echo "Refusing: VITROS_DISPOSABLE_DATABASE=1 is required" >&2
  exit 2
fi
for name in PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE; do
  [[ -n "${!name:-}" ]] || { echo "Missing $name" >&2; exit 2; }
done

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# Two real PostgreSQL sessions reserve distinct manual physical lines.
(
  psql -v ON_ERROR_STOP=1 <<'SQL'
begin;
select public.reserve_incoming_manual_line('concurrent-actor','DOC-MANUAL-RACE');
select pg_sleep(1.0);
commit;
SQL
) >"$tmp/manual-a.log" 2>&1 &
pid_a=$!
sleep 0.15
(
  psql -v ON_ERROR_STOP=1 <<'SQL'
select public.reserve_incoming_manual_line('concurrent-actor','DOC-MANUAL-RACE');
SQL
) >"$tmp/manual-b.log" 2>&1 &
pid_b=$!
wait "$pid_a"
wait "$pid_b"

manual_count="$(psql -Atv ON_ERROR_STOP=1 -c "select count(*) from public.incoming_receipt_lines where document_ref_normalized='DOC-MANUAL-RACE' and source_page_normalized='MANUAL'")"
manual_lines="$(psql -Atv ON_ERROR_STOP=1 -c "select count(distinct source_line_no) from public.incoming_receipt_lines where document_ref_normalized='DOC-MANUAL-RACE' and source_page_normalized='MANUAL'")"
[[ "$manual_count" == "2" && "$manual_lines" == "2" ]] || {
  echo "Concurrent manual reservations were not distinct: rows=$manual_count lines=$manual_lines" >&2
  exit 1
}

# Prepare one abandoned, no-movement source line for a same-line re-review race.
psql -v ON_ERROR_STOP=1 <<'SQL'
select public.register_incoming_receipt_review('race-actor','DOC-REREVIEW-RACE','7',1,'ABC123',1,null);
select public.register_incoming_receipt_review('race-actor','DOC-REREVIEW-RACE','7',1,'ABC123',2,null);
select public.abandon_incoming_receipt_attempt(
  a.id,'race-actor',a.revision,'verified no movement'
)
from public.incoming_receipt_attempts a
join public.incoming_receipt_lines l on l.id=a.line_id
where l.document_ref_normalized='DOC-REREVIEW-RACE' and a.state='conflict';
SQL

attempt_id="$(psql -Atv ON_ERROR_STOP=1 -c "select a.id from public.incoming_receipt_attempts a join public.incoming_receipt_lines l on l.id=a.line_id where l.document_ref_normalized='DOC-REREVIEW-RACE' and a.state='abandoned'")"
revision="$(psql -Atv ON_ERROR_STOP=1 -c "select a.revision from public.incoming_receipt_attempts a join public.incoming_receipt_lines l on l.id=a.line_id where l.document_ref_normalized='DOC-REREVIEW-RACE' and a.state='abandoned'")"
[[ -n "$attempt_id" && -n "$revision" ]] || { echo "Failed to prepare re-review race fixture" >&2; exit 1; }

# Session A creates generation 2 and holds the old-attempt lock until commit.
(
  psql -v ON_ERROR_STOP=1 -v aid="$attempt_id" -v rev="$revision" <<'SQL'
\set VERBOSITY verbose
begin;
select public.rereview_incoming_receipt_attempt(:'aid'::uuid,'race-actor',:'rev'::bigint,null,null);
select pg_sleep(1.0);
commit;
SQL
) >"$tmp/rereview-a.log" 2>&1 &
pid_a=$!
sleep 0.15

# Session B uses the same pre-race revision and must deterministically lose.
(
  psql -v ON_ERROR_STOP=1 -v aid="$attempt_id" -v rev="$revision" <<'SQL'
\set VERBOSITY verbose
select public.rereview_incoming_receipt_attempt(:'aid'::uuid,'race-actor',:'rev'::bigint,null,null);
SQL
) >"$tmp/rereview-b.log" 2>&1 &
pid_b=$!
wait "$pid_a"
if wait "$pid_b"; then
  echo "Second same-line re-review unexpectedly succeeded" >&2
  cat "$tmp/rereview-b.log" >&2
  exit 1
fi
if ! grep -q "40001: Receipt attempt revision is stale" "$tmp/rereview-b.log"; then
  echo "Second re-review did not fail with the expected SQLSTATE/message" >&2
  cat "$tmp/rereview-b.log" >&2
  exit 1
fi

active_count="$(psql -Atv ON_ERROR_STOP=1 -c "select count(*) from public.incoming_receipt_attempts a join public.incoming_receipt_lines l on l.id=a.line_id where l.document_ref_normalized='DOC-REREVIEW-RACE' and a.state<>'abandoned'")"
active_generation="$(psql -Atv ON_ERROR_STOP=1 -c "select max(a.generation) from public.incoming_receipt_attempts a join public.incoming_receipt_lines l on l.id=a.line_id where l.document_ref_normalized='DOC-REREVIEW-RACE' and a.state<>'abandoned'")"
spawn_events="$(psql -Atv ON_ERROR_STOP=1 -c "select count(*) from public.incoming_receipt_attempt_events e where e.attempt_id='$attempt_id'::uuid and e.event_type='rereview_spawned'")"
[[ "$active_count" == "1" && "$active_generation" == "2" && "$spawn_events" == "1" ]] || {
  echo "Same-line recovery serialization failed: active=$active_count generation=$active_generation spawn_events=$spawn_events" >&2
  exit 1
}

echo "INCOMING_RECEIPT_DURABLE_RECOVERY_CONCURRENCY=PASS"
