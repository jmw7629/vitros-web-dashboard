const TARGET_SHA = "2021053df996ed6643d34de7e1dc70e067c6a23a";
const URL = `https://raw.githubusercontent.com/jmw7629/vitros-web-dashboard/${TARGET_SHA}/src/pages/inventory/SapStaging.tsx`;

const response = await fetch(URL, { cache: "no-store" });
if (!response.ok) throw new Error(`target fetch failed: ${response.status}`);
const source = await response.text();

function requireAll(tokens) {
  for (const token of tokens) {
    if (!source.includes(token)) throw new Error(`missing invariant: ${token}`);
  }
}
function forbidAll(tokens) {
  for (const token of tokens) {
    if (source.includes(token)) throw new Error(`forbidden invariant: ${token}`);
  }
}

requireAll([
  'const sapRecords = useMemo(() =>',
  '[...(data.sapRecords || [])].sort(',
  'const visibleRows = useMemo(() =>',
  'return [...filtered].sort(',
  'const gridTemplateColumns = tab !== "exported"',
  'const visibleIds = visibleRows.map',
  'everyVisibleSelected',
  'Deselect Visible',
  'aria-label="Search SAP staging records"',
  'Swipe horizontally inside the table to view all columns.',
  'max-h-[55vh] overflow-auto overscroll-contain',
  'scrollbarGutter: "stable both-edges"',
  'role="table"',
  'sticky top-0 z-10 grid',
  'gridTemplateColumns,',
  'role="columnheader"',
  'role="row"',
  'exported / posted',
  'Export to SAP',
  'downloadCSV(rows',
]);

forbidAll([
  'data.sapRecords.sort(',
  'updateSapStatus(',
  'useAction(',
  'fetch(',
  'Post to SAP',
  'Posted to SAP',
]);

const sharedGridUses = (source.match(/gridTemplateColumns/g) || []).length;
if (sharedGridUses < 3) throw new Error(`shared grid contract referenced only ${sharedGridUses} times`);

const scrollContexts = (source.match(/overflow-auto overscroll-contain/g) || []).length;
if (scrollContexts !== 1) throw new Error(`expected exactly one table scroll context, found ${scrollContexts}`);

console.log(`VERIFY=PASS SHA=${TARGET_SHA}`);
