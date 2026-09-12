// REM workbook parser acceptance - synthetic fixtures invoking actual production parser via TypeScript transpilation
// Like incoming-stock-acceptance, executes exact src/lib/remWorkbookAuthoritative.ts behavior
// Run with: node scripts/rem-workbook-parser-acceptance.mjs
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as XLSX from "xlsx";

const sourcePath = "src/lib/remWorkbookAuthoritative.ts";
let source = fs.readFileSync(sourcePath, "utf8");
source = source.replace(/^\s*import\s+\*\s+as\s+XLSX\s+from\s+["']xlsx["'];?\s*$/m, "// import stripped for sandbox");
source = source.replace(/^export\s+/gm, "");
const transpiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2020 },
}).outputText;
const context = { XLSX, Map, Set, Number, String, Boolean, JSON, Array, Object, Math, isFinite, isNaN, parseInt, parseFloat, Infinity, NaN, undefined, RangeError, TypeError, Error, RegExp, Date, console };
vm.createContext(context);
vm.runInContext(`${transpiled}\nthis.__api={parseAuthoritativeRemWorkbook};`, context);
const { parseAuthoritativeRemWorkbook } = context.__api;
if (typeof parseAuthoritativeRemWorkbook !== "function") throw new Error("parseAuthoritativeRemWorkbook not extracted");

function assert(c,m){ if(!c) throw new Error(m); }
function equal(a,b,m){ if(a!==b) throw new Error(`${m}: expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`); }

function makeBaseWorkbook(){
  const wb = XLSX.utils.book_new();
  const summary = XLSX.utils.aoa_to_sheet([["Summary"]]);
  XLSX.utils.book_append_sheet(wb, summary, "2025 Summary");
  const wipData = [
    ["Production Order","WIP","Clean","Service","FL","Release/Clean","Pack"],
    [],
    [1,"36001234",10,20,30,40,50],
    [2,"36001235",15,25,35,45,55],
    [3,"56001234",5,15,25,35,45],
    [4,"76001234",20,30,40,50,60],
    [5,"36009999",12,22,32,42,52],
    [6,"56009999",18,28,38,48,58],
  ];
  const wip = XLSX.utils.aoa_to_sheet(wipData);
  XLSX.utils.book_append_sheet(wb, wip, "WIP Productivity VITROS WK 5");
  const header = [];
  for(let g=0;g<4;g++) header.push("product","quarter","week","date","plan","actuals");
  const trackerAoa = [header];
  const products = ["VITROS","VISION","LVCC Electrometer","LVCC IR Wash"];
  for(let week=1; week<=10; week++){
    const row=[];
    for(let g=0;g<4;g++) row.push(products[g], `Q1`, week, `2025-01-${String(week).padStart(2,"0")}`, 100+week*10+g, 90+week+g);
    trackerAoa.push(row);
  }
  const tracker = XLSX.utils.aoa_to_sheet(trackerAoa);
  XLSX.utils.book_append_sheet(wb, tracker, "Tracker");
  const bpCols=62;
  const bpHeader=new Array(bpCols).fill(null);
  bpHeader[0]="Quarter"; bpHeader[1]="Week"; bpHeader[2]="Date"; bpHeader[3]="3600"; bpHeader[4]="5600"; bpHeader[5]="7600"; bpHeader[14]="Head Count";
  const bpAoa=[bpHeader];
  for(let week=1;week<=20;week++){
    const row=new Array(bpCols).fill(null);
    row[0]=`Q${Math.ceil(week/13)||1}`; row[1]=week; row[2]=`2025-01-${String(week).padStart(2,"0")}`; row[3]=5+week; row[4]=6+week; row[5]=7+week; row[14]=10+week;
    bpAoa.push(row);
  }
  const bp = XLSX.utils.aoa_to_sheet(bpAoa);
  XLSX.utils.book_append_sheet(wb, bp, "Build Plan");
  const staffHeader=["WWID","Name","Role","FTE","Cleaning","DHR","Service","Final Line","Release/Clean","Pack","Troubleshoot","SOF/Parts","VISION","LVCC","Started","Complete after","Required/Optional","FE online","FE Classroom","Training Unitl","Comment"];
  const staffAoa=[staffHeader];
  for(let i=1;i<=5;i++) staffAoa.push([`10000${i}`,`Synthetic User ${i}`,"Engineer",1,"A","B","C","D","E","F","G","H","I","J","2024-01-01","2025-12-31","Required","Online","Classroom","","Comment"]);
  const staff = XLSX.utils.aoa_to_sheet(staffAoa);
  XLSX.utils.book_append_sheet(wb, staff, "Staff");
  const notesHeader=["Quarter","","Date","VITROS","VISION","LVCC Electrometer","LVCC IR Wash","Week"];
  const notesAoa=[notesHeader, ["Q1","","2025-01-06","vitros note week 1","vision note","electrometer","ir","1"], ["Q1","","2025-01-13","vitros note week 2","","","","2"]];
  const notes = XLSX.utils.aoa_to_sheet(notesAoa);
  XLSX.utils.book_append_sheet(wb, notes, "Notes - Issues");
  const field = XLSX.utils.aoa_to_sheet([["Field","Status"],["A","OK"]]);
  XLSX.utils.book_append_sheet(wb, field, "Field Status VITROS");
  const chart = XLSX.utils.aoa_to_sheet([["Chart","Data"],["X","Y"]]);
  XLSX.utils.book_append_sheet(wb, chart, "Chart Analysis");
  return wb;
}

console.log("=== REM Workbook Parser Acceptance (production parser, synthetic) ===\n");
let passed=0, failed=0;
function run(name, fn){
  try{ fn(); console.log(`PASS: ${name}`); passed++; } catch(e){ console.log(`FAIL: ${name} -> ${e.message}`); console.log(e.stack?.split("\n").slice(0,4).join("\n")); failed++; }
}

run("renamed filename same parsed data", ()=>{
  const wb=makeBaseWorkbook();
  const a=parseAuthoritativeRemWorkbook("REM_2025_Production.xlsx","hashA", wb);
  const b=parseAuthoritativeRemWorkbook("totally_different_name.xls","hashA", wb);
  equal(a.planYear,b.planYear,"planYear");
  equal(a.analyzers.length,b.analyzers.length,"analyzers");
  equal(a.trackerWeekly.length,b.trackerWeekly.length,"tracker");
  equal(a.buildPlan.length,b.buildPlan.length,"buildPlan");
  equal(a.staff.length,b.staff.length,"staff");
  equal(JSON.stringify(a.targets), JSON.stringify(b.targets),"targets");
  assert(a.fileName!==b.fileName,"filename differs but data same");
});

run("normal cached formula accepted", ()=>{
  const wb=makeBaseWorkbook();
  const tracker=wb.Sheets["Tracker"];
  const addr=XLSX.utils.encode_cell({r:1,c:4});
  tracker[addr]={ t:"n", v:999, f:"SUM(D2:D3)", w:"999" };
  const p=parseAuthoritativeRemWorkbook("file.xlsx","hash2",wb);
  const vitros=p.trackerWeekly.find(r=>r.product==="VITROS"&&r.weekNumber===1);
  assert(vitros,"vitros wk1"); equal(vitros.plan,999,"cached formula accepted");
});

run("relevant missing-cache rejected with location", ()=>{
  const wb=makeBaseWorkbook();
  const tracker=wb.Sheets["Tracker"];
  const addr=XLSX.utils.encode_cell({r:2,c:4});
  tracker[addr]={ f:"SUM(A1)", t:"z" };
  let threw=false;
  try{ parseAuthoritativeRemWorkbook("file.xlsx","hash3",wb); } catch(e){ threw=true; const m=String(e.message); assert(m.toLowerCase().includes("cached")||m.toLowerCase().includes("recalculate")||m.toLowerCase().includes("formula"),"mentions cache/formula: "+m); assert(m.includes("Tracker")||m.includes(addr)||m.includes("!"),"identifies sheet/cell or field: "+m); }
  assert(threw,"should throw missing cache");
});

run("relevant error-cache rejected with location", ()=>{
  const wb=makeBaseWorkbook();
  const tracker=wb.Sheets["Tracker"];
  const addr=XLSX.utils.encode_cell({r:1,c:10});
  tracker[addr]={ t:"e", v:15, f:"1/0", w:"#DIV/0!" };
  let threw=false;
  try{ parseAuthoritativeRemWorkbook("file.xlsx","hash4",wb);} catch(e){ threw=true; const m=String(e.message); assert(m.toLowerCase().includes("error")||m.toLowerCase().includes("cached"),"error cache: "+m); assert(m.includes("Tracker")||m.includes(addr),"location: "+m);}
  assert(threw,"error cache should throw");
});

run("cached blank formula under deliberate blank policy preserved", ()=>{
  const wb=makeBaseWorkbook();
  // Tracker actual is optional; set its formula to cached blank "" (deliberate blank)
  const tracker=wb.Sheets["Tracker"];
  const addr=XLSX.utils.encode_cell({r:1,c:5}); // actuals for VITROS week1
  tracker[addr]={ t:"s", v:"", f:"IF(A1=\"\",\"\",42)", w:"" };
  const p=parseAuthoritativeRemWorkbook("file.xlsx","hashBlank",wb);
  const vitros=p.trackerWeekly.find(r=>r.product==="VITROS"&&r.weekNumber===1);
  assert(vitros,"found"); assert(vitros.actual===undefined,"blank cached formula preserved as undefined not rejected");
});

run("malformed numeric rejected with location", ()=>{
  const wb=makeBaseWorkbook();
  const tracker=wb.Sheets["Tracker"];
  const addr=XLSX.utils.encode_cell({r:1,c:10});
  tracker[addr]={ t:"s", v:"N/A", w:"N/A" };
  let threw=false;
  try{ parseAuthoritativeRemWorkbook("file.xlsx","hash5",wb);} catch(e){ threw=true; const m=String(e.message); assert(m.toLowerCase().includes("malformed"),"malformed: "+m); assert(m.includes("Tracker")||m.includes(addr)||m.includes("VISION"),"identifies field/sheet/cell: "+m); }
  assert(threw,"malformed numeric should reject");
  // Build Plan malformed
  const wb2=makeBaseWorkbook();
  const bp=wb2.Sheets["Build Plan"];
  const bpAddr=XLSX.utils.encode_cell({r:1,c:3});
  bp[bpAddr]={ t:"s", v:"bad", w:"bad" };
  let threw2=false;
  try{ parseAuthoritativeRemWorkbook("file.xlsx","hash5b",wb2);} catch(e){ threw2=true; assert(String(e.message).toLowerCase().includes("malformed"),"build plan malformed: "+e.message); }
  assert(threw2,"build plan malformed should reject");
});

run("unrelated formula does not block", ()=>{
  const wb=makeBaseWorkbook();
  const chart=wb.Sheets["Chart Analysis"];
  chart["A2"]={ f:"SUM(B1:B10)", t:"z" };
  chart["B2"]={ t:"e", v:0, f:"1/0", w:"#VALUE!" };
  const extra=XLSX.utils.aoa_to_sheet([["A","B"],[1,2]]);
  extra["A2"]={ f:"A1*2", t:"z" };
  XLSX.utils.book_append_sheet(wb, extra, "Extra Analysis");
  const p=parseAuthoritativeRemWorkbook("file.xlsx","hash6",wb);
  assert(p.trackerWeekly.length>=40,"tracker still parses");
  assert(p.buildPlan.length>=20,"buildPlan still parses");
});

run("ignored sheets accurately disclosed", ()=>{
  const wb=makeBaseWorkbook();
  const p=parseAuthoritativeRemWorkbook("file.xlsx","hash7",wb);
  const imported=p.importedSheets ?? p.recognizedSheets;
  const unimported=p.unimportedSheets;
  assert(Array.isArray(imported) && Array.isArray(unimported),"exposes imported/unimported");
  assert(imported.includes("Tracker") && imported.includes("Build Plan") && imported.includes("Staff") && imported.includes("Notes - Issues"),"imported includes required");
  assert(imported.some(n=>n.toLowerCase().includes("wip productivity vitros")),"imported includes WIP");
  assert(!imported.includes("Field Status VITROS"),"Field Status not imported");
  assert(unimported.includes("Field Status VITROS"),"Field Status in unimported");
  assert(unimported.includes("Chart Analysis"),"Chart in unimported");
  assert(imported.length===5,"exactly 5 imported");
  assert(JSON.stringify(p.recognizedSheets)===JSON.stringify(imported),"recognizedSheets alias equals imported for compatibility");
});


const consumedFormulaCells = [
  ["WIP Productivity VITROS WK 5", "B3"], // serial identity
  ["WIP Productivity VITROS WK 5", "C3"], // progress
  ["Tracker", "A2"], // product identity
  ["Tracker", "C2"], // week identity
  ["Tracker", "D2"], // date
  ["Tracker", "B2"], // quarter
  ["Build Plan", "C2"], // date
  ["Build Plan", "A2"], // quarter
  ["Staff", "A2"], // employee identity
  ["Staff", "B2"], // name used for row eligibility
  ["Staff", "C2"], // role
  ["Staff", "D2"], // numeric FTE
  ["Staff", "E2"], // qualification
  ["Staff", "O2"], // date
  ["Staff", "Q2"], // certification
  ["Staff", "U2"], // comment
  ["Notes - Issues", "D2"], // note content
  ["Notes - Issues", "C2"], // date
];
for (const kind of ["missing", "error"]) {
  run(`${kind} formula cache rejects every consumed identity/date/text path`, () => {
    for (const [sheetName, address] of consumedFormulaCells) {
      const wb = makeBaseWorkbook();
      wb.Sheets[sheetName][address] = kind === "missing"
        ? { t: "n", f: "1+1" }
        : { t: "e", v: 15, f: "1/0", w: "#VALUE!" };
      let message = "";
      try { parseAuthoritativeRemWorkbook("renamed.xlsx", "hash", wb); }
      catch (error) { message = error.message; }
      assert(message.includes(`${sheetName}!${address}`), `Expected formula rejection at ${sheetName}!${address}, got ${message}`);
    }
  });
}
run("footer labels remain ignored without parsing their payloads", () => {
  const wb = makeBaseWorkbook();
  XLSX.utils.sheet_add_aoa(wb.Sheets["Build Plan"], [["", "Total", "", "not an imported number"]], { origin: -1 });
  XLSX.utils.sheet_add_aoa(wb.Sheets["Notes - Issues"], [["", "", "", "Summary", "", "", "", "Total"]], { origin: -1 });
  const result = parseAuthoritativeRemWorkbook("file.xlsx", "hash", wb);
  equal(result.buildPlan.length, 20, "footer is not a build week");
  equal(result.weeklyNotes.length, 2, "footer is not a note week");
});
run("unconsumed cells in imported sheets do not block", () => {
  const wb = makeBaseWorkbook();
  wb.Sheets["Build Plan"].T2 = { t: "n", f: "1+1" }; // spacer, not a mapped field
  parseAuthoritativeRemWorkbook("file.xlsx", "hash", wb);
});
run("Tracker actual retains established upper bound", () => {
  const wb = makeBaseWorkbook();
  wb.Sheets.Tracker.F2 = { t: "n", v: 100001 };
  let rejected = false;
  try { parseAuthoritativeRemWorkbook("file.xlsx", "hash", wb); }
  catch (error) { rejected = /outside the supported range/.test(error.message); }
  assert(rejected, "actual over 100000 must be rejected");
});
run("synthetic XLSX roundtrip preserves accepted cached data and rejected missing cache", () => {
  const readLikeBrowser = (wb) => XLSX.read(XLSX.write(wb, { type: "array", bookType: "xlsx" }), { type: "array", cellDates: true });
  const wb = makeBaseWorkbook();
  wb.Sheets.Tracker.E2 = { t: "n", v: 123, f: "SUM(100,23)" };
  const preview = parseAuthoritativeRemWorkbook("renamed.xlsx", "hash", readLikeBrowser(wb));
  equal(preview.trackerWeekly[0].plan, 123, "actual serialized cache used");
  wb.Sheets["WIP Productivity VITROS WK 5"].C3 = { t: "n", f: "1+1" };
  let message = "";
  try { parseAuthoritativeRemWorkbook("renamed.xlsx", "hash", readLikeBrowser(wb)); }
  catch (error) { message = error.message; }
  assert(message.includes("WIP Productivity VITROS WK 5!C3"), "serialized missing cache must fail with location: " + message);
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if(failed>0) process.exit(1);
console.log("REM_WORKBOOK_PARSER_ACCEPTANCE=PASS");
console.log("MALFORMED_NUMERIC_REJECTED");
console.log("FORMULA_CACHE_MISSING_REJECTED");
console.log("FORMULA_CACHE_ERROR_REJECTED");
console.log("FORMULA_CACHED_ACCEPTED");
console.log("FORMULA_CACHED_BLANK_PRESERVED");
console.log("UNRELATED_FORMULA_IGNORED");
console.log("IGNORED_SHEETS_DISCLOSED");
console.log("RENAME_SAME_DATA");
