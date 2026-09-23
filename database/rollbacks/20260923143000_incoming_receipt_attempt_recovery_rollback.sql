-- Rollback for 20260923143000_incoming_receipt_attempt_recovery.sql
-- Guarded rollback: only allowed before any attempt/event history exists.
begin;

do $$
begin
  if to_regclass('public.incoming_receipt_attempts') is not null
     and exists (select 1 from public.incoming_receipt_attempts) then
    raise exception 'Rollback blocked: incoming receipt attempt history exists';
  end if;
  if to_regclass('public.incoming_receipt_attempt_events') is not null
     and exists (select 1 from public.incoming_receipt_attempt_events) then
    raise exception 'Rollback blocked: incoming receipt attempt event history exists';
  end if;
end;
$$;

drop function if exists public.resolve_incoming_receipt_attempt(uuid,text,bigint);
drop function if exists public.acknowledge_incoming_receipt_attempt(uuid,text);
drop function if exists public.mark_incoming_receipt_attempt_unknown(uuid,text);
drop function if exists public.execute_incoming_receipt_attempt(uuid,text,bigint);
drop function if exists public.register_incoming_receipt_review(text,text,text,text,text,text,text,text);
drop function if exists public.list_incoming_receipt_recovery(text);
drop function if exists public.reserve_incoming_manual_receipt_review(text,text,text,integer);
drop function if exists public.incoming_receipt_attempt_events_immutable();
drop table if exists public.incoming_receipt_attempt_events;
drop table if exists public.incoming_receipt_attempts;
commit;