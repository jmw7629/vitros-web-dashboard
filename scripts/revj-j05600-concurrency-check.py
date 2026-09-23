"""Reproduce the J05600 DHR/config race with the real PostgreSQL path.
Disposable localhost PostgreSQL 17 only; Production hosts are rejected.
"""
import os
from pathlib import Path
import re
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
FORWARD = ROOT / "supabase/migrations/20260923084652_revj_j05600_section.sql"
REVERSE = ROOT / "database/rollbacks/20260923084652_revj_j05600_section.sql"
PART_ID = "44900000-0000-4000-8000-000000000001"
SESSION_FWD = "44900000-0000-4000-8000-000000000002"
SESSION_REV = "44900000-0000-4000-8000-000000000003"
CORR_FWD = "revj-449-forward-writer"
CORR_REV = "revj-449-reverse-writer"


def base_env(app="revj-449-check"):
    if os.environ.get("VITROS_DISPOSABLE_DATABASE") != "1":
        raise RuntimeError("Explicit disposable database flag required")
    container = os.environ.get("VITROS_QA_CONTAINER", "")
    if container:
        if not re.fullmatch(r"vitros-449-fixture-[a-z0-9-]+", container):
            raise RuntimeError("Unexpected test container")
    elif os.environ.get("PGHOST") not in ("localhost", "127.0.0.1", "::1"):
        raise RuntimeError("Only localhost PostgreSQL is accepted")
    elif os.environ.get("PGDATABASE") != "dhr_document_test":
        raise RuntimeError("Only dhr_document_test is accepted")
    env = os.environ.copy()
    env["PGAPPNAME"] = app
    return env


def psql_args(app="revj-449-check"):
    container = os.environ.get("VITROS_QA_CONTAINER", "")
    base = ["psql", "-X", "-A", "-t", "-q", "-v", "ON_ERROR_STOP=1"]
    if not container:
        return base
    return ["docker", "exec", "-i", "-e", f"PGAPPNAME={app}", container] + base + ["-U", "postgres", "-d", "vitros_449_test"]


def run_sql(sql, app="revj-449-check", timeout=15):
    return subprocess.run(
        psql_args(app) + ["-c", sql], env=base_env(app), text=True,
        capture_output=True, timeout=timeout,
    )


def run_file(path, app, timeout=9):
    return subprocess.run(
        psql_args(app), input=path.read_text(), env=base_env(app), text=True,
        capture_output=True, timeout=timeout,
    )


def start_sql(sql, app):
    return subprocess.Popen(
        psql_args(app) + ["-c", sql], env=base_env(app), text=True,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )


def scalar(sql):
    run = run_sql(sql)
    if run.returncode:
        raise AssertionError(run.stderr)
    return run.stdout.strip()


def wait_blocked(app, timeout=6):
    deadline = time.time() + timeout
    while time.time() < deadline:
        row = scalar(
            "select coalesce(wait_event_type,'')||':'||coalesce(wait_event,'')||':'||"
            "cardinality(pg_blocking_pids(pid)) from pg_stat_activity "
            f"where application_name='{app}' and pid<>pg_backend_pid()"
        )
        if row.startswith("Lock:") and not row.endswith(":0"):
            return row
        time.sleep(0.1)
    raise AssertionError(f"{app} never reached a real blocked lock wait")


def backend_pid(app):
    value = scalar(
        "select pid from pg_stat_activity "
        f"where application_name='{app}' and pid<>pg_backend_pid() order by pid limit 1"
    )
    if not value:
        raise AssertionError(f"backend not found for {app}")
    return int(value)


def terminate(pid):
    value = scalar(f"select pg_terminate_backend({pid})")
    if value != "t":
        raise AssertionError(f"failed to terminate disposable holder {pid}")


def assert_ok(run, label):
    if run.returncode:
        raise AssertionError(f"{label} failed: {run.stderr}")


def seed():
    sql = f"""
    insert into public.stock(id,part_number,description,qty_on_hand)
      values ('{PART_ID}','J05600','Synthetic J05600 race fixture',20);
    insert into public.dhr_expected_parts(id,analyzer_model,section_id,part_number,description,bom_qty,category)
      values ('{PART_ID}','5600','5.10','J05600','Filter, Air',1,'required');
    insert into public.dhr_scan_sessions(id,instrument_sn,wo_number,analyzer_model,status)
      values ('{SESSION_FWD}','SYNTHETIC-449-F','QA-449-F','5600','in_progress');
    """
    assert_ok(run_sql(sql), "seed")


def add_reverse_session():
    sql = f"""
    insert into public.dhr_scan_sessions(id,instrument_sn,wo_number,analyzer_model,status)
      values ('{SESSION_REV}','SYNTHETIC-449-R','QA-449-R','5600','in_progress');
    """
    assert_ok(run_sql(sql), "reverse seed")


def holder_sql():
    return """begin;
    select id from public.stock where part_number='J05600' for update;
    select pg_sleep(30);
    commit;"""


def writer_sql(session_id, section, correlation, serial):
    return f"""begin;
    select public.apply_dhr_scan_transition(
      '{session_id}','{section}','J05600',1,1,'required','Filter, Air',
      'Synthetic QA (SQ)','{correlation}',0,'{serial}');
    commit;"""


def wait_holder(app, timeout=6):
    deadline = time.time() + timeout
    while time.time() < deadline:
        row = scalar(
            "select coalesce(wait_event_type,'')||':'||coalesce(wait_event,'') "
            f"from pg_stat_activity where application_name='{app}' and pid<>pg_backend_pid()"
        )
        if row == "Timeout:PgSleep":
            return
        time.sleep(0.1)
    raise AssertionError(f"{app} did not acquire stock lock before sleeping")


def run_race(label, migration, session_id, section, correlation, serial):
    holder_app = f"revj-449-{label}-holder"
    writer_app = f"revj-449-{label}-writer"
    holder = start_sql(holder_sql(), holder_app)
    writer = None
    try:
        wait_holder(holder_app)
        holder_pid = backend_pid(holder_app)
        writer = start_sql(writer_sql(session_id, section, correlation, serial), writer_app)
        lock_evidence = wait_blocked(writer_app)
        migration_run = run_file(migration, f"revj-449-{label}-migration")
        if migration_run.returncode == 0:
            raise AssertionError(f"{label} migration crossed a blocked DHR writer")
        if "lock timeout" not in migration_run.stderr.lower():
            raise AssertionError(f"{label} failed for wrong reason: {migration_run.stderr}")
        actual_section = scalar(
            "select section_id from public.dhr_expected_parts "
            "where analyzer_model='5600' and upper(btrim(part_number))='J05600'"
        )
        if actual_section != section:
            raise AssertionError(f"{label} changed expected config while writer blocked: {actual_section}")
        terminate(holder_pid)
        holder.communicate(timeout=5)
        writer_out, writer_err = writer.communicate(timeout=10)
        if writer.returncode:
            raise AssertionError(f"{label} real DHR writer failed: {writer_err}")
        return lock_evidence, writer_out.strip()
    finally:
        if writer and writer.poll() is None:
            writer.kill()
            writer.communicate()
        if holder.poll() is None:
            holder.kill()
            holder.communicate()


def assert_history(session_id, section):
    result = scalar(
        "select section_id||':'||scanned_qty||':rev'||revision from public.dhr_scan_results "
        f"where session_id='{session_id}' and upper(btrim(part_number))='J05600'"
    )
    event = scalar(
        "select section_id||':'||new_qty from public.dhr_scan_result_events "
        f"where session_id='{session_id}' and upper(btrim(part_number))='J05600'"
    )
    if result != f"{section}:1:rev1" or event != f"{section}:1":
        raise AssertionError(f"history mismatch: result={result} event={event}")


def mark_deleted(session_id):
    assert_ok(run_sql(
        f"update public.dhr_scan_sessions set status='deleted' where id='{session_id}'"
    ), "mark fixture deleted")


def cleanup_non_history():
    sql = f"""
    delete from public.inventory_operations where correlation_id in ('{CORR_FWD}','{CORR_REV}');
    delete from public.audit_log where correlation_id in ('{CORR_FWD}','{CORR_REV}');
    delete from public.sap_staging where correlation_id in ('{CORR_FWD}','{CORR_REV}');
    delete from public.dhr_expected_parts where id='{PART_ID}';
    delete from public.stock where id='{PART_ID}';
    """
    assert_ok(run_sql(sql), "fixture cleanup")


def main():
    base_env()
    seed()
    forward_lock, _ = run_race(
        "forward", FORWARD, SESSION_FWD, "5.10", CORR_FWD, "SYNTHETIC-449-F"
    )
    assert_history(SESSION_FWD, "5.10")
    mark_deleted(SESSION_FWD)
    assert_ok(run_file(FORWARD, "revj-449-forward-after-drain"), "forward after drain")
    if scalar("select section_id from public.dhr_expected_parts where id='" + PART_ID + "'") != "5.12":
        raise AssertionError("forward did not move exact row after writer drained")

    add_reverse_session()
    reverse_lock, _ = run_race(
        "reverse", REVERSE, SESSION_REV, "5.12", CORR_REV, "SYNTHETIC-449-R"
    )
    assert_history(SESSION_REV, "5.12")
    mark_deleted(SESSION_REV)
    assert_ok(run_file(REVERSE, "revj-449-reverse-after-drain"), "reverse after drain")
    if scalar("select section_id from public.dhr_expected_parts where id='" + PART_ID + "'") != "5.10":
        raise AssertionError("reverse did not restore exact row after writer drained")
    cleanup_non_history()
    print(f"FORWARD_BLOCK_EVIDENCE={forward_lock}")
    print(f"REVERSE_BLOCK_EVIDENCE={reverse_lock}")
    print("REVJ_J05600_CONCURRENCY_SERIALIZATION=PASS")
    print("REVJ_J05600_REVERSE_SERIALIZATION=PASS")
    print("BLOCKERS=none")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        print(f"REVJ_J05600_CONCURRENCY_SERIALIZATION=FAIL\nBLOCKERS={exc}", file=sys.stderr)
        raise
