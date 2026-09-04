const TARGET_SHA = "6f57a0beb76717273684eae2265f34980ced0013";
const url = `https://raw.githubusercontent.com/jmw7629/vitros-web-dashboard/${TARGET_SHA}/src/pages/inventory/SapStaging.tsx`;
const res = await fetch(url, { cache: "no-store" });
if (!res.ok) throw new Error(`Failed to fetch exact target ${TARGET_SHA}: ${res.status}`);
const source = await res.text();

const mustContain = [
  'const gridTemplateColumns = tab !== "exported"',
  'className="max-h-[55vh] overflow-auto overscroll-contain"',
  'className="min-w-[760px]"',
  'className="sticky top-0 z-10 grid items-center',
  'gridTemplateColumns,',
];
for (const token of mustContain) {
  if (!source.includes(token)) throw new Error(`Missing required SAP scroll-sync invariant: ${token}`);
}

const sharedGridUses = (source.match(/gridTemplateColumns,/g) || []).length;
if (sharedGridUses < 2) throw new Error(`Expected shared grid template in header and rows; found ${sharedGridUses}`);

if (source.includes('divide-y max-h-[55vh] overflow-y-auto')) {
  throw new Error("Legacy independently scrolling row body is still present");
}
if (source.includes('gridTemplateColumns: tab !== "exported"')) {
  throw new Error("Header/body still duplicate separate inline grid definitions");
}

const outerScroll = source.indexOf('className="max-h-[55vh] overflow-auto overscroll-contain"');
const stickyHeader = source.indexOf('className="sticky top-0 z-10 grid items-center');
const rowGrid = source.indexOf('className="grid items-center px-4 py-2.5 transition-colors cursor-pointer"');
if (!(outerScroll >= 0 && stickyHeader > outerScroll && rowGrid > stickyHeader)) {
  throw new Error("Sticky header and rows are not inside the same scroll context in expected order");
}

console.log(`VERIFY=PASS SHA=${TARGET_SHA} SAP_SCROLL_CONTEXT=SHARED HEADER_STICKY=YES GRID_TEMPLATE=SHARED RESPONSIVE_MIN_WIDTH=YES`);
