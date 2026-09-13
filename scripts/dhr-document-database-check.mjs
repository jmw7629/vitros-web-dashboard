// Exact existing production inventory/scanner functions + new bridge, disposable DB only.
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite();
try{
 for(const file of [
  'database/tests/dhr_document_bootstrap.sql',
  'database/migrations/20260830_vitros_atomic_inventory_transition.sql',
  'database/migrations/20260909_extend_inventory_operations_with_material_request.sql',
  'database/migrations/20260903_dhr_atomic_scan_transition.sql',
  'supabase/migrations/20260906131500_dhr_controlled_inventory_alias.sql',
  'supabase/migrations/20260905191500_dhr_legacy_baseline_guard.sql',
  'supabase/migrations/20260913133922_dhr_document_field_bridge.sql',
  'database/tests/dhr_document_bridge.sql',
 ]){await db.exec(fs.readFileSync(file,'utf8'));console.log(`PASS ${file}`);}
 console.log('DIGITAL_DHR_ATOMIC_CONSUMPTION_IDEMPOTENCY_AGGREGATION_ACTOR_ROLLBACK=PASS');
}catch(error){console.error(JSON.stringify({message:error.message,code:error.code,where:error.where,position:error.position}));process.exitCode=1;}
finally{await db.close();}
