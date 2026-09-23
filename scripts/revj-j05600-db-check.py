"""Execute the exact one-shot SQL file on a disposable PostgreSQL database.
Never accepts a Production host/database. Each scenario rolls back independently.
The CI job must first apply its real dhr-document-database bootstrap/migrations.
"""
import json
import os
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
FORWARD = ROOT / 'supabase/migrations/20260923084652_revj_j05600_section.sql'
REVERSE = ROOT / 'database/rollbacks/20260923084652_revj_j05600_section.sql'
PART_ID = '43300000-0000-4000-8000-000000000001'
SESSION_ID = '43300000-0000-4000-8000-000000000002'
RESULT_ID = '43300000-0000-4000-8000-000000000003'
TABLES = ['stock','audit_log','sap_staging','inventory_operations','settings',
          'convex_employees','dhr_scan_sessions','dhr_scan_results','dhr_scan_result_events',
          'digital_dhr_manifests','digital_dhr_instances','digital_dhr_field_state',
          'digital_dhr_part_totals','digital_dhr_consumption_events']


def command():
    if os.environ.get('VITROS_DISPOSABLE_DATABASE') != '1':
        raise RuntimeError('Explicit disposable database flag required')
    container = os.environ.get('VITROS_QA_CONTAINER', '')
    if container:
        if not re.fullmatch(r'vitros-433-fixture-[a-z0-9-]+', container):
            raise RuntimeError('Unexpected test container')
        return ['docker','exec','-i',container,'psql','-X','-U','postgres',
                '-d','vitros_433_test','-v','ON_ERROR_STOP=1']
    if os.environ.get('PGHOST') not in ('localhost','127.0.0.1','::1') or os.environ.get('PGDATABASE') != 'dhr_document_test':
        raise RuntimeError('Only the disposable CI database is accepted')
    return ['psql','-X','-v','ON_ERROR_STOP=1']


def execute(sql):
    return subprocess.run(command(), input=sql, text=True, capture_output=True, timeout=30)


def literal(value):
    return "'" + value.replace("'", "''") + "'"


def dump_tables():
    parts = []
    for name in TABLES:
        parts.extend([literal(name), "(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public."+name+" t)"])
    return 'jsonb_build_object(' + ','.join(parts) + ')'


def seed(history=None):
    sql = f"INSERT INTO public.dhr_expected_parts(id,analyzer_model,section_id,part_number,description,bom_qty,category) VALUES ('{PART_ID}','5600','5.10','J05600','Filter, Air',1,'required');\n"
    if history is not None:
        sql += f"INSERT INTO public.dhr_scan_sessions(id,instrument_sn,wo_number,analyzer_model,status) VALUES ('{SESSION_ID}','SYNTHETIC-433','QA-ONLY','5600',{literal(history)});\n"
        sql += f"INSERT INTO public.dhr_scan_results(id,session_id,section_id,part_number,description,expected_qty,scanned_qty,category,status) VALUES ('{RESULT_ID}','{SESSION_ID}','5.10','J05600','Historical snapshot',1,0,'required','matched');\n"
    return sql


BINDING = "public.validate_digital_dhr_manifest(jsonb_build_object('schemaVersion',1,'templateId','synthetic-433','documentRevision','J','analyzerModel','5600','artifactSha256',repeat('a',64),'bindings',jsonb_build_array(jsonb_build_object('fieldId','P040_TEXT_0243','sectionId','5.12','partNumber','J05600','kind','consumable_part','quantityMode','integer'))))"


def scenario(setup, migration, expected_error=None, binding=False, reverse=False):
    # EXECUTE runs the literal bytes read from the actual migration file. There is
    # no stand-in reconciliation function or string-only behavior assertion.
    exact = literal(migration)
    if expected_error:
        apply = f"""BEGIN
          EXECUTE {exact};
        EXCEPTION WHEN SQLSTATE 'P0001' THEN
          GET STACKED DIAGNOSTICS actual_error=MESSAGE_TEXT;
          IF actual_error IS DISTINCT FROM {literal(expected_error)} THEN RAISE; END IF;
          rejected:=true;
        END;
        IF NOT rejected THEN RAISE EXCEPTION 'qa_missing_expected_rejection'; END IF;"""
        expected = 'expected_before'
    else:
        apply = 'EXECUTE ' + exact + ';'
        section = '5.10' if reverse else '5.12'
        expected = f"jsonb_set(expected_before,ARRAY['{PART_ID}','section_id'],to_jsonb('{section}'::text),false)"
    return f"""BEGIN;
    SET LOCAL statement_timeout='15s';
    {setup}
    DO $test$
    DECLARE protected_before jsonb; expected_before jsonb; expected_after jsonb;
            actual_error text; rejected boolean:=false;
    BEGIN
      protected_before:={dump_tables()};
      SELECT coalesce(jsonb_object_agg(id::text,to_jsonb(t)), '{{}}'::jsonb)
        INTO expected_before FROM public.dhr_expected_parts t;
      {apply}
      SELECT coalesce(jsonb_object_agg(id::text,to_jsonb(t)), '{{}}'::jsonb)
        INTO expected_after FROM public.dhr_expected_parts t;
      IF expected_after IS DISTINCT FROM {expected} THEN
        RAISE EXCEPTION 'qa_expected_rows_changed_incorrectly';
      END IF;
      IF protected_before IS DISTINCT FROM {dump_tables()} THEN
        RAISE EXCEPTION 'qa_protected_history_or_business_data_changed';
      END IF;
      {'PERFORM '+BINDING+';' if binding else ''}
    END
    $test$;
    ROLLBACK;
    """


def cases(forward, reverse_sql):
    change = lambda assignment: f"UPDATE public.dhr_expected_parts SET {assignment} WHERE id='{PART_ID}';\n"
    duplicate = "INSERT INTO public.dhr_expected_parts(analyzer_model,section_id,part_number,description,bom_qty,category) VALUES ('5600','5.10',' J05600 ','Filter, Air',1,'required');\n"
    conflicting = duplicate.replace("'5.10'", "'5.12'")
    corrected = seed('deleted') + forward + '\n'
    return [
      ('one_exact_row_and_real_manifest_binding',seed(),forward,None,True,False),
      ('matched_result_in_deleted_session_is_preserved',seed('deleted'),forward,None,True,False),
      ('active_session_rejected',seed('in_progress'),forward,'revj_j05600_session_conflict',False,False),
      ('completed_session_rejected',seed('completed'),forward,'revj_j05600_session_conflict',False,False),
      ('conflicting_target_rejected',seed()+conflicting,forward,'revj_j05600_target_conflict',False,False),
      ('wrong_description_rejected',seed()+change("description='Wrong description'"),forward,'revj_j05600_source_attributes',False,False),
      ('wrong_category_rejected',seed()+change("category='tool'"),forward,'revj_j05600_source_attributes',False,False),
      ('wrong_bom_rejected',seed()+change('bom_qty=2'),forward,'revj_j05600_source_attributes',False,False),
      ('missing_source_rejected','',forward,'revj_j05600_source_count',False,False),
      ('multiple_sources_rejected',seed()+duplicate,forward,'revj_j05600_source_count',False,False),
      ('repeat_application_rejected',corrected,forward,'revj_j05600_source_count',False,False),
      ('guarded_reverse_preserves_deleted_history',corrected,reverse_sql,None,False,True),
      ('reverse_target_conflict_rejected',corrected+duplicate,reverse_sql,'revj_j05600_reverse_target_conflict',False,True),
      ('reverse_non_deleted_history_rejected',corrected+f"UPDATE public.dhr_scan_sessions SET status='in_progress' WHERE id='{SESSION_ID}';",reverse_sql,'revj_j05600_reverse_session_conflict',False,True),
      ('null_session_status_rejected',seed('in_progress')+f"UPDATE public.dhr_scan_sessions SET status=NULL WHERE id='{SESSION_ID}';",forward,'revj_j05600_session_conflict',False,False),
    ]


def main():
    command()  # Fail before any test when the environment is not explicit.
    forward=FORWARD.read_text(); reverse_sql=REVERSE.read_text(); results=[]
    for name,setup,migration,error,binding,reverse in cases(forward,reverse_sql):
        run=execute(scenario(setup,migration,error,binding,reverse))
        results.append({'case':name,'passed':run.returncode==0})
        print(('PASS ' if run.returncode==0 else 'FAIL ')+name,flush=True)
        if run.returncode: print(run.stderr,flush=True)
        # A deliberately successful NO-OP must NOT be caught as the expected failure.
        if error:
            mutant=execute(scenario(setup,'DO $noop$ BEGIN NULL; END $noop$;',error,binding,reverse))
            caught=mutant.returncode!=0 and 'qa_missing_expected_rejection' in mutant.stderr
            results.append({'case':name+'_rejects_noop_mutation','passed':caught})
            print(('PASS ' if caught else 'FAIL ')+name+'_rejects_noop_mutation',flush=True)
            unrelated=execute(scenario(setup,"DO $bad$ BEGIN RAISE EXCEPTION USING ERRCODE='22012', MESSAGE='qa_unrelated_failure'; END $bad$;",error,binding,reverse))
            propagated=unrelated.returncode!=0 and 'qa_unrelated_failure' in unrelated.stderr
            results.append({'case':name+'_propagates_unrelated_error','passed':propagated})
            print(('PASS ' if propagated else 'FAIL ')+name+'_propagates_unrelated_error',flush=True)
    print(json.dumps({'cases':len(results),'passed':sum(x['passed'] for x in results),'production':False}))
    print('REVJ_J05600_SECTION_RECONCILIATION_V3='+('PASS' if all(x['passed'] for x in results) else 'FAIL'))
    return 0 if all(x['passed'] for x in results) else 1

if __name__=='__main__':sys.exit(main())
