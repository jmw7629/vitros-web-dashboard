#!/usr/bin/env bash
set -euo pipefail

: "${VITROS_DISPOSABLE_DATABASE:?must be 1}"
[[ "$VITROS_DISPOSABLE_DATABASE" == "1" ]]
[[ "${PGDATABASE:-}" == *test* ]]

PSQL=(psql -v ON_ERROR_STOP=1 -X -qAt)
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

corr='incoming:CONCURRENT-DOC|1|1'
actor='concurrent-actor'

# Hold the exact reservation advisory lock so the second authorized client must wait.
"${PSQL[@]}" >"$tmp/a" <<'SQL' &
begin;
select pg_advisory_xact_lock(hashtextextended('incoming-receipt-line:incoming:CONCURRENT-DOC|1|1',0));
select pg_sleep(0.8);
select public.register_incoming_receipt_review(
  'concurrent-actor','CONCURRENT-DOC','1',1,'ABC123',4,
  'incoming:CONCURRENT-DOC|1|1','CONCURRENT-DOC'
)->>'attemptId';
commit;
SQL
pid_a=$!
sleep 0.15
"${PSQL[@]}" >"$tmp/b" <<'SQL' &
select public.register_incoming_receipt_review(
  'concurrent-actor','CONCURRENT-DOC','1',1,'ABC123',4,
  'incoming:CONCURRENT-DOC|1|1','CONCURRENT-DOC'
)->>'attemptId';
SQL
pid_b=$!
wait "$pid_a"
wait "$pid_b"

attempt_a="$(grep -E '^[0-9a-f-]{36}$' "$tmp/a" | tail -1)"
attempt_b="$(grep -E '^[0-9a-f-]{36}$' "$tmp/b" | tail -1)"
[[ -n "$attempt_a" && "$attempt_a" == "$attempt_b" ]]

revision="$(${PSQL[@]} -c "select revision from public.incoming_receipt_attempts where id='$attempt_a'::uuid")"
[[ "$revision" == "1" ]]

# Both clients execute the same persisted attempt. Row locking plus inventory idempotency
# must serialize them so only one physical RECEIVE movement is recorded.
"${PSQL[@]}" -c "select public.execute_incoming_receipt_attempt('$attempt_a'::uuid,'$actor',$revision)->>'state'" >"$tmp/exec-a" &
pid_a=$!
"${PSQL[@]}" -c "select public.execute_incoming_receipt_attempt('$attempt_b'::uuid,'$actor',$revision)->>'state'" >"$tmp/exec-b" &
pid_b=$!
wait "$pid_a"
wait "$pid_b"
for file in "$tmp/exec-a" "$tmp/exec-b"; do
  grep -qx 'accepted' "$file"
done

"${PSQL[@]}" <<'SQL'
do $$
begin
  if (select qty_on_hand from public.stock where part_number='ABC123') <> 24 then
    raise exception 'Concurrent receipt moved stock more or less than once';
  end if;
  if (select count(*) from public.inventory_operations where correlation_id='incoming:CONCURRENT-DOC|1|1') <> 1 then
    raise exception 'Concurrent receipt created more than one inventory operation';
  end if;
  if (select count(*) from public.audit_log where correlation_id='incoming:CONCURRENT-DOC|1|1') <> 1 then
    raise exception 'Concurrent receipt created more than one audit event';
  end if;
  if (select count(*) from public.sap_staging where correlation_id='incoming:CONCURRENT-DOC|1|1') <> 1 then
    raise exception 'Concurrent receipt created more than one pending SAP row';
  end if;
end $$;
SQL

# Two clients manually reserving the same actor/document must receive distinct persisted physical identities.
"${PSQL[@]}" -c "select public.reserve_incoming_manual_receipt_review('manual-concurrent','MANUAL-CONCURRENT','ABC123',1)->>'sourceLineNo'" >"$tmp/manual-a" &
pid_a=$!
"${PSQL[@]}" -c "select public.reserve_incoming_manual_receipt_review('manual-concurrent','MANUAL-CONCURRENT','ABC123',1)->>'sourceLineNo'" >"$tmp/manual-b" &
pid_b=$!
wait "$pid_a"
wait "$pid_b"
manual_a="$(grep -E '^[0-9]+$' "$tmp/manual-a" | tail -1)"
manual_b="$(grep -E '^[0-9]+$' "$tmp/manual-b" | tail -1)"
[[ -n "$manual_a" && -n "$manual_b" && "$manual_a" != "$manual_b" ]]
[[ "$(printf '%s\n%s\n' "$manual_a" "$manual_b" | sort -n | tr '\n' ' ' | sed 's/ $//')" == "1 2" ]]
"${PSQL[@]}" <<'SQL'
do $$
begin
  if (select count(*) from public.incoming_receipt_attempts where actor='manual-concurrent' and document_ref_normalized='MANUAL-CONCURRENT' and source_page_normalized='MANUAL') <> 2 then
    raise exception 'Concurrent manual reservations were not both persisted';
  end if;
  if (select count(distinct correlation_id) from public.incoming_receipt_attempts where actor='manual-concurrent' and document_ref_normalized='MANUAL-CONCURRENT' and source_page_normalized='MANUAL') <> 2 then
    raise exception 'Concurrent manual reservations collided on correlation identity';
  end if;
  if (select count(*) from public.inventory_operations where correlation_id like 'incoming:MANUAL-CONCURRENT|MANUAL|%') <> 0 then
    raise exception 'Manual reservation mutated inventory';
  end if;
end $$;
SQL

echo 'INCOMING_RECEIPT_CONCURRENCY=PASS'
