import { useState, useRef, useEffect, useCallback } from "react";
import { X, ZoomIn, ZoomOut, RotateCcw, ExternalLink, Package, ChevronRight } from "lucide-react";
import { useConvexData } from "../hooks/useConvexData";

/* ── Module definitions with position (% of image), name, description, and part keywords ── */
interface ModuleDef {
  code: string;
  name: string;
  description: string;
  x: number; // % from left
  y: number; // % from top
  partKeywords: string[]; // keywords to match against inventory parts
}

const modules: ModuleDef[] = [
  { code: "MB", name: "MicroImmunoassay Reagent Supply", description: "Stores and dispenses immunoassay reagent packs for MicroWell testing.", x: 5.5, y: 51, partKeywords: ["reagent", "immunoassay", "pack lifter microwell", "MWPO", "micro well detector"] },
  { code: "TB", name: "MicroImmunoassay Metering", description: "Meters and dispenses immunoassay reagents into MicroWell plates.", x: 18, y: 46, partKeywords: ["metering", "immunoassay", "dispense tip", "probe arm", "tip strop"] },
  { code: "TM", name: "MicroWell Incubator", description: "Temperature-controlled incubation of MicroWell reaction plates.", x: 26, y: 32, partKeywords: ["microwell", "incubator", "well shuttle", "shuttle drive", "well dispense", "well dump", "IR wash", "MCA"] },
  { code: "MG", name: "MicroWell Reagent Metering", description: "Precision metering of reagents into MicroWell plates.", x: 31, y: 44, partKeywords: ["MWRM", "well reagent", "metering", "MWWA"] },
  { code: "MF", name: "MicroWell Reagent Supply", description: "Storage and supply of MicroWell reagent packs.", x: 25, y: 58, partKeywords: ["reagent supply", "pack lifter", "microwell", "MWPO"] },
  { code: "MJ", name: "Preliminary Well Wash", description: "Initial wash cycle for MicroWell plates before signal detection.", x: 33.5, y: 64, partKeywords: ["wash prelim", "well wash", "wash bottle", "wash nozzle", "WRSU", "WRSP", "wash filter", "wash cam"] },
  { code: "MH", name: "Signal Reagent", description: "Dispenses signal reagent for chemiluminescent detection.", x: 39, y: 50, partKeywords: ["signal reagent", "SR pump", "SR probe", "SR waste", "signal", "SR nozzle"] },
  { code: "MK", name: "Luminometer", description: "Measures chemiluminescent light output from immunoassay reactions.", x: 40, y: 60, partKeywords: ["luminometer", "lum to incubat", "optical sensor"] },
  { code: "TP", name: "Photometer", description: "Measures absorbance of MicroSlide reactions for colorimetric assays.", x: 40, y: 31, partKeywords: ["photometer", "reflectometer", "mirror", "optical", "lamp"] },
  { code: "TN", name: "Final Well Wash", description: "Final cleaning wash for MicroWell plates after luminometer reading.", x: 42, y: 37, partKeywords: ["wash final", "well wash", "wash assy"] },
  { code: "TL", name: "Cuvette Incubator", description: "Temperature-controlled incubation for cuvette-based reactions.", x: 50, y: 42, partKeywords: ["cuvette incubator", "cuvette", "incubator ring"] },
  { code: "TK", name: "MicroTip / Cuvette Supply", description: "Loads and supplies disposable MicroTips and cuvettes to the system.", x: 52, y: 53, partKeywords: ["microtip", "micro tip", "cuvette supply", "tip load", "tip feed", "tip sealer", "MTPC", "carousel", "carrier tip"] },
  { code: "TC", name: "MicroSensor CuveTip Ring", description: "Rotary ring that positions cuvettes and tips for metering operations.", x: 54, y: 25, partKeywords: ["cuvetip", "sensor", "ring", "rotor"] },
  { code: "TT", name: "VersaTip Ring", description: "Rotary mechanism for positioning VersaTips during sample metering.", x: 63, y: 26, partKeywords: ["versatip", "versa", "tip ring"] },
  { code: "TD", name: "Sample Supply", description: "Sample handling and distribution — racks, cups, and barcode reading.", x: 64, y: 50, partKeywords: ["sample", "SAHA", "rack", "barcode"] },
  { code: "TE", name: "ERF Metering", description: "ERF (Enhanced Reagent Fluid) precision metering for slide chemistry.", x: 73, y: 31, partKeywords: ["ERF", "metering", "fluid"] },
  { code: "TF", name: "MicroSlide Metering / Slide Supply", description: "Loads VITROS MicroSlide cartridges and meters samples onto slides.", x: 81, y: 32, partKeywords: ["slide", "cartridge", "slide kicker", "slide supply", "blade dispense", "blade insert"] },
  { code: "TJ", name: "MicroSlide Incubator", description: "Large heated incubation wheel for dry-chemistry MicroSlide reactions.", x: 77, y: 50, partKeywords: ["slide incubator", "incubator", "thin film", "friction plate"] },
  { code: "TG", name: "WF Metering", description: "Wash Fluid metering — delivers wash solutions throughout the system.", x: 77, y: 58, partKeywords: ["wash fluid", "WF", "wash station", "valve", "pump"] },
  { code: "TA", name: "Slide Supply / Electrometer", description: "Slide cartridge loading area and electrometer for potentiometric assays.", x: 84, y: 43, partKeywords: ["electrometer", "slide supply", "potentiometric"] },
  { code: "TY", name: "Electrometer", description: "Measures electrical potential for ion-selective electrode (ISE) assays.", x: 88, y: 56, partKeywords: ["electrometer", "ISE", "electrode", "DSP"] },
];

/* ── Part matching logic ── */
function matchPartsToModule(mod: ModuleDef, parts: any[]): any[] {
  if (!parts || parts.length === 0) return [];
  const matched: any[] = [];
  for (const part of parts) {
    const desc = (part.description || "").toLowerCase();
    const pn = (part.partNumber || "").toLowerCase();
    for (const kw of mod.partKeywords) {
      if (desc.includes(kw.toLowerCase()) || pn.includes(kw.toLowerCase())) {
        matched.push(part);
        break;
      }
    }
  }
  return matched.sort((a: any, b: any) => (a.description || "").localeCompare(b.description || ""));
}

export function SystemDiagram() {
  const { parts } = useConvexData();
  const [selectedModule, setSelectedModule] = useState<ModuleDef | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  const handleZoomIn = () => setZoom(z => Math.min(z + 0.3, 4));
  const handleZoomOut = () => setZoom(z => Math.max(z - 0.3, 0.5));
  const handleReset = () => { setZoom(1); setPan({ x: 0, y: 0 }); };

  /* ── Wheel zoom ── */
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.15 : 0.15;
    setZoom(z => Math.min(Math.max(z + delta, 0.5), 4));
  }, []);

  /* ── Touch / mouse pan ── */
  const handlePointerDown = (e: React.PointerEvent) => {
    if (zoom <= 1) return;
    setIsPanning(true);
    setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };
  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isPanning) return;
    setPan({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
  };
  const handlePointerUp = () => setIsPanning(false);

  /* ── Pinch zoom for mobile ── */
  const lastTouchDist = useRef(0);
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      lastTouchDist.current = Math.sqrt(dx * dx + dy * dy);
    }
  };
  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const scale = dist / lastTouchDist.current;
      setZoom(z => Math.min(Math.max(z * scale, 0.5), 4));
      lastTouchDist.current = dist;
    }
  };

  const matchedParts = selectedModule ? matchPartsToModule(selectedModule, parts) : [];

  return (
    <div className="flex flex-col h-[calc(100vh-96px)] select-none">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b" style={{ backgroundColor: "#111827", borderColor: "#1e293b" }}>
        <div className="flex items-center gap-2">
          <span className="text-lg">🔬</span>
          <h1 className="text-sm font-bold text-white">VITROS 5600 System Diagram</h1>
          <span className="text-[10px] text-slate-400 bg-slate-800 px-2 py-0.5 rounded-full">{modules.length} modules</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={handleZoomOut} className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors">
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="text-[11px] text-slate-400 w-10 text-center">{Math.round(zoom * 100)}%</span>
          <button onClick={handleZoomIn} className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors">
            <ZoomIn className="w-4 h-4" />
          </button>
          <button onClick={handleReset} className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors ml-1">
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Diagram area */}
      <div
        ref={containerRef}
        className="flex-1 relative overflow-hidden"
        style={{ backgroundColor: "#0a0f1a", cursor: zoom > 1 ? (isPanning ? "grabbing" : "grab") : "default" }}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
      >
        {/* Zoomable/pannable container */}
        <div
          className="relative w-full h-full flex items-center justify-center"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: "center center",
            transition: isPanning ? "none" : "transform 0.2s ease-out"
          }}
        >
          {/* Image wrapper — maintains aspect ratio */}
          <div className="relative" style={{ width: "100%", maxWidth: "1200px" }}>
            <img
              src="/vitros-5600-diagram.jpg"
              alt="VITROS 5600 Integrated System"
              className="w-full h-auto rounded-lg shadow-2xl"
              draggable={false}
              style={{ filter: "brightness(1.05) contrast(1.05)" }}
            />

            {/* Clickable module hotspots */}
            {modules.map((mod) => (
              <button
                key={mod.code}
                onClick={(e) => { e.stopPropagation(); setSelectedModule(mod); }}
                className="absolute group"
                style={{
                  left: `${mod.x}%`,
                  top: `${mod.y}%`,
                  transform: "translate(-50%, -50%)",
                  zIndex: 10
                }}
                title={`${mod.code} — ${mod.name}`}
              >
                {/* Pulse ring */}
                <div className="absolute inset-0 rounded-full animate-ping opacity-30"
                  style={{ backgroundColor: "#3b82f6", width: "28px", height: "28px", margin: "-4px" }}
                />
                {/* Hotspot circle */}
                <div className="relative w-5 h-5 rounded-full flex items-center justify-center text-[7px] font-black text-white shadow-lg transition-all duration-200 group-hover:scale-150 group-hover:shadow-blue-500/50"
                  style={{
                    background: "radial-gradient(circle at 35% 35%, #60a5fa, #1d4ed8)",
                    boxShadow: "0 0 8px rgba(59,130,246,0.5), 0 2px 4px rgba(0,0,0,0.3)"
                  }}
                >
                  {mod.code}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Tap hint */}
        {!selectedModule && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 px-3 py-1.5 rounded-full" style={{ backgroundColor: "rgba(30,41,59,0.9)", backdropFilter: "blur(8px)" }}>
            <div className="w-3 h-3 rounded-full animate-pulse" style={{ background: "radial-gradient(circle, #60a5fa, #1d4ed8)" }} />
            <span className="text-[11px] text-slate-300">Tap a module to view associated parts</span>
          </div>
        )}
      </div>

      {/* Module detail slide-up panel */}
      {selectedModule && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-40" onClick={() => setSelectedModule(null)} />
          {/* Panel */}
          <div
            className="fixed bottom-0 left-0 right-0 z-50 rounded-t-2xl border-t max-h-[70vh] flex flex-col animate-in slide-in-from-bottom duration-300"
            style={{ backgroundColor: "#111827", borderColor: "#1e3a5f" }}
          >
            {/* Handle */}
            <div className="flex justify-center pt-2 pb-1">
              <div className="w-10 h-1 rounded-full bg-slate-600" />
            </div>
            {/* Header */}
            <div className="flex items-start justify-between px-4 pb-3">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center text-[10px] font-black text-white"
                    style={{ background: "radial-gradient(circle at 35% 35%, #60a5fa, #1d4ed8)" }}
                  >
                    {selectedModule.code}
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white">{selectedModule.name}</h3>
                    <p className="text-[11px] text-slate-400">{selectedModule.description}</p>
                  </div>
                </div>
              </div>
              <button onClick={() => setSelectedModule(null)} className="p-1 rounded-lg hover:bg-white/10 text-slate-400">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Parts list */}
            <div className="flex-1 overflow-y-auto px-4 pb-6">
              <div className="flex items-center gap-2 mb-2">
                <Package className="w-3.5 h-3.5 text-blue-400" />
                <span className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider">
                  Associated Parts ({matchedParts.length})
                </span>
              </div>
              {matchedParts.length === 0 ? (
                <div className="text-center py-6">
                  <p className="text-xs text-slate-500">No parts mapped to this module yet.</p>
                  <p className="text-[10px] text-slate-600 mt-1">Part mappings can be configured in settings.</p>
                </div>
              ) : (
                <div className="space-y-1">
                  {matchedParts.map((part: any, i: number) => {
                    const isLow = (part.qoh || 0) <= (part.minQty || part.min || 0);
                    const isOut = (part.qoh || 0) === 0;
                    return (
                      <div key={part._id || i} className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-white/5 transition-colors" style={{ backgroundColor: "rgba(30,41,59,0.5)" }}>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] font-mono font-semibold text-blue-400">{part.partNumber}</span>
                            {isOut && <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-red-500/20 text-red-400">STOCK-OUT</span>}
                            {isLow && !isOut && <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400">LOW</span>}
                          </div>
                          <p className="text-[10px] text-slate-400 truncate">{part.description || "—"}</p>
                        </div>
                        <div className="text-right ml-3 shrink-0">
                          <div className="text-xs font-bold text-white">{part.qoh ?? 0}</div>
                          <div className="text-[9px] text-slate-500">QOH</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
