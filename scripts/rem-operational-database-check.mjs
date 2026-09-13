// Runs exact production migration functions against a pristine disposable DB.
// No credentials/network access, no production writes, and no mocked core RPC.
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as XLSX from 'xlsx';
import { PGlite } from '@electric-sql/pglite';
const db = new PGlite();
try {
  for (const path of [
    'database/tests/rem_operational_bootstrap.sql',
    'supabase/migrations/20260905074500_rem_authoritative_workbook_parity.sql',
    'supabase/migrations/20260913123239_rem_operational_staged_import.sql',
    'database/tests/rem_operational_import.sql',
  ]) {
    await db.exec(fs.readFileSync(path, 'utf8'));
    console.log(`PASS ${path}`);
  }
  console.log('REM_OPERATIONAL_ATOMIC_CORE_STAGING_RETRY_AUDIT_PAGINATION=PASS');
  if (process.env.REM_WORKBOOK_PATH) {
    const exports = {};
    vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/remOperationalWorkbook.ts','utf8'), {
      compilerOptions: {module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
    }).outputText,{exports,Date,require:name=>{if(name==='xlsx')return XLSX;throw new Error('Unexpected parser dependency');}});
    const workbook=XLSX.read(fs.readFileSync(process.env.REM_WORKBOOK_PATH),{type:'buffer',cellDates:true,cellFormula:true});
    const {records}=exports.parseRemOperationalWorkbook(workbook,2026);
    const fingerprint='0123456789abcdef'.repeat(4);
    const begin=await db.query('select public.begin_rem_operational_import($1,2026,$2,$3) receipt',[fingerprint,records.length,'synthetic-actor']);
    const importId=begin.rows[0].receipt.importId;
    const started=Date.now();
    for(let index=0;index<records.length;index+=250) {
      await db.query('select public.stage_rem_operational_import($1,$2,$3::jsonb,$4)',[importId,index/250,JSON.stringify(records.slice(index,index+250)),'synthetic-actor']);
      if(index%6250===0)console.log(`REAL_WORKBOOK_SQL_STAGING rows=${Math.min(index+250,records.length)}/${records.length}`);
    }
    const finalizeStarted=Date.now();
    const receipt=(await db.query('select public.test_rem_core($1,$2) receipt',[fingerprint,importId])).rows[0].receipt;
    const stats=receipt.operational;
    // Earlier synthetic fixtures intentionally share two annual summary keys.
    if(stats.rows!==records.length||stats.inserted+stats.updated+stats.unchanged!==records.length)throw new Error('Real operational row count mismatch');
    console.log(`REAL_WORKBOOK_FULL_ATOMIC_SQL=PASS rows=${records.length} stagingMs=${finalizeStarted-started} finalizeMs=${Date.now()-finalizeStarted}`);
  }
  console.log('NOTE=disposable embedded PostgreSQL; live concurrent and browser acceptance are separate');
} catch (error) {
  console.error(JSON.stringify({ message:error.message, code:error.code, where:error.where }));
  process.exitCode=1;
} finally { await db.close(); }
