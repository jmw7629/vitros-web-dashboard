-- Guarded reverse for #442 durable Incoming Stock recovery foundation.
-- Refuses to erase any persisted durable receipt history or reserved physical identity.
begin;
do $$
begin
  if to_regclass('public.incoming_receipt_attempt_events') is not null
     and exists(select 1 from public.incoming_receipt_attempt_events) then
    raise exception using errcode='55000', message='Rollback blocked: incoming receipt event history exists';
  end if;
  if to_regclass('public.incoming_receipt_attempts') is not null
     and exists(select 1 from public.incoming_receipt_attempts) then
    raise exception using errcode='55000', message='Rollback blocked: incoming receipt attempt history exists';
  end if;
  if to_regclass('public.incoming_receipt_lines') is not null
     and exists(select 1 from public.incoming_receipt_lines) then
    raise exception using errcode='55000', message='Rollback blocked: incoming receipt line history exists';
  end if;
  if to_regclass('public.incoming_receipt_manual_counters') is not null
     and exists(select 1 from public.incoming_receipt_manual_counters) then
    raise exception using errcode='55000', message='Rollback blocked: incoming receipt manual reservation history exists';
  end if;
end;
$$;

drop function if exists public.list_incoming_receipt_recovery(text);
drop function if exists public.acknowledge_incoming_receipt_attempt(uuid,text);
drop function if exists public.rereview_incoming_receipt_attempt(uuid,text,bigint,text,integer);
drop function if exists public.abandon_incoming_receipt_attempt(uuid,text,bigint,text);
drop function if exists public.execute_incoming_receipt_attempt(uuid,text,bigint);
drop function if exists public.mark_incoming_receipt_attempt_unknown(uuid,text,bigint);
drop function if exists public.begin_incoming_receipt_attempt(uuid,text,bigint);
drop function if exists public.register_incoming_receipt_review(text,text,text,integer,text,integer,uuid);
drop function if exists public.reserve_incoming_manual_line(text,text);
drop function if exists public.incoming_receipt_attempt_payload(public.incoming_receipt_attempts);

drop table if exists public.incoming_receipt_attempt_events;
drop table if exists public.incoming_receipt_attempts;
drop table if exists public.incoming_receipt_lines;
drop table if exists public.incoming_receipt_manual_counters;

drop function if exists public.incoming_receipt_attempt_delete_blocked();
drop function if exists public.incoming_receipt_attempt_identity_immutable();
drop function if exists public.incoming_receipt_events_immutable();
commit;
