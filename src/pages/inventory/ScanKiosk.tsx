import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useConvexData } from "../../hooks/useConvexData";
import { WebCard, StatusBadge, DashCard, theme, statusColor, modeColor, formatDate } from "../../components/vitros/SharedComponents";
import { Camera, X, Search, Plus, Minus, RotateCcw, Package, ChevronRight } from "lucide-react";
import { readBarcodesFromImageData, type ReaderOptions } from "zxing-wasm/reader";

// ── ZXing reader options (cross-browser barcode formats) ──
const ZXING_OPTS: ReaderOptions = {
  formats: ["Code128", "Code39", "EAN-13", "EAN-8", "UPC-E", "QRCode", "DataMatrix", "Code93", "ITF", "Codabar"],
  tryHarder: true,
  maxNumberOfSymbols: 1,
};

// ── Web Barcode Scanner — native BarcodeDetector + ZXing WASM fallback ──
function WebBarcodeScanner({ onScan, onClose }: { onScan: (code: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<"requesting" | "scanning" | "denied" | "unsupported">("requesting");
  const [lastScanned, setLastScanned] = useState("");
  const [manualInput, setManualInput] = useState("");
  const [scanEngine, setScanEngine] = useState<"native" | "zxing" | "none">("none");
  const scanningRef = useRef(true);
  const lastScanTimeRef = useRef(0);

  const handleDetected = useCallback((rawValue: string) => {
    const now = Date.now();
    if (now - lastScanTimeRef.current > 1500) {
      lastScanTimeRef.current = now;
      const code = rawValue.trim().toUpperCase();
      setLastScanned(code);
      if (navigator.vibrate) navigator.vibrate(100);
      setTimeout(() => onScan(code), 400);
    }
  }, [onScan]);

  useEffect(() => {
    let animFrame: number;
    let detector: any = null;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    async function startScanning() {
      const hasBarcodeDetector = "BarcodeDetector" in window;

      // Try multiple constraint sets for maximum iOS/Android compatibility
      const constraintAttempts = [
        { video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } } },
        { video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } } },
        { video: { facingMode: "environment" } },
        { video: { facingMode: { ideal: "environment" } } },
        { video: true },
      ];

      let stream: MediaStream | null = null;
      for (const constraints of constraintAttempts) {
        try {
          stream = await navigator.mediaDevices.getUserMedia(constraints);
          break;
        } catch (e: any) {
          console.warn("Constraint attempt failed:", constraints, e.name);
          if (e.name === "NotAllowedError" || e.name === "PermissionDeniedError") {
            setStatus("denied");
            return;
          }
          continue;
        }
      }

      if (!stream) {
        setStatus("unsupported");
        return;
      }

      try {
        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          // iOS Safari needs explicit attribute setting
          videoRef.current.setAttribute("playsinline", "true");
          videoRef.current.setAttribute("webkit-playsinline", "true");
          videoRef.current.muted = true;
          await videoRef.current.play().catch(() => {
            // iOS sometimes needs a user gesture — try again
            setTimeout(() => videoRef.current?.play(), 100);
          });
        }
        setStatus("scanning");

        // Prefer native BarcodeDetector (Chrome, Safari 16.4+)
        if (hasBarcodeDetector) {
          try {
            detector = new (window as any).BarcodeDetector({
              formats: ["code_128", "code_39", "ean_13", "ean_8", "upc_e", "qr_code", "data_matrix", "code_93", "itf", "codabar"]
            });
            setScanEngine("native");
          } catch {
            detector = null;
          }
        }

        // Fall back to ZXing WASM (Firefox, older Safari, all other browsers)
        if (!detector) {
          setScanEngine("zxing");
        }

        // Shared scan loop — dispatches to whichever engine is available
        let zxingBusy = false;
        const scanFrame = async () => {
          if (!scanningRef.current || !videoRef.current) return;
          const video = videoRef.current;
          if (video.readyState !== video.HAVE_ENOUGH_DATA) {
            animFrame = requestAnimationFrame(scanFrame);
            return;
          }

          if (detector) {
            // ── Native BarcodeDetector path ──
            try {
              const barcodes = await detector.detect(video);
              if (barcodes.length > 0) {
                handleDetected(barcodes[0].rawValue);
              }
            } catch { /* ignore detect errors */ }
          } else if (!zxingBusy && ctx) {
            // ── ZXing WASM path — grab frame to ImageData, decode ──
            zxingBusy = true;
            try {
              canvas.width = video.videoWidth;
              canvas.height = video.videoHeight;
              ctx.drawImage(video, 0, 0);
              const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
              const results = await readBarcodesFromImageData(imageData, ZXING_OPTS);
              if (results.length > 0 && results[0].text) {
                handleDetected(results[0].text);
              }
            } catch { /* ignore decode errors */ }
            zxingBusy = false;
          }

          animFrame = requestAnimationFrame(scanFrame);
        };

        scanFrame();
      } catch (err: any) {
        console.warn("Camera error:", err);
        if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
          setStatus("denied");
        } else {
          setStatus("unsupported");
        }
      }
    }

    startScanning();

    return () => {
      scanningRef.current = false;
      if (animFrame) cancelAnimationFrame(animFrame);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
      }
    };
  }, [handleDetected]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={onClose} className="p-2 rounded-xl" style={{ backgroundColor: theme.cardBg }}>
          <X className="w-5 h-5" style={{ color: theme.textPrimary }} />
        </button>
        <h2 className="text-lg font-bold" style={{ color: theme.textPrimary }}>Barcode Scanner</h2>
        {status === "scanning" && (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: "#22c55e20", color: "#22c55e" }}>
            ● LIVE
          </span>
        )}
        {status === "scanning" && (
          <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ backgroundColor: theme.cardBg, color: theme.textMuted }}>
            {scanEngine === "native" ? "Native" : "ZXing"}
          </span>
        )}
      </div>

      {/* Camera viewfinder */}
      <div className="relative rounded-2xl overflow-hidden" style={{ backgroundColor: "#000", aspectRatio: "4/3" }}>
        {status === "scanning" && (
          <video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 w-full h-full object-cover" />
        )}
        <canvas ref={canvasRef} className="hidden" />

        {/* Viewfinder overlay */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-56 h-32 border-2 border-white/30 rounded-xl relative">
            <div className="absolute top-0 left-0 w-6 h-6 border-t-2 border-l-2 border-white rounded-tl-lg" />
            <div className="absolute top-0 right-0 w-6 h-6 border-t-2 border-r-2 border-white rounded-tr-lg" />
            <div className="absolute bottom-0 left-0 w-6 h-6 border-b-2 border-l-2 border-white rounded-bl-lg" />
            <div className="absolute bottom-0 right-0 w-6 h-6 border-b-2 border-r-2 border-white rounded-br-lg" />
            <div className="absolute left-2 right-2 h-0.5 bg-red-500 top-1/2 animate-pulse" />
          </div>
        </div>

        {/* Status overlay */}
        {status === "requesting" && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center text-white">
              <div className="animate-spin w-8 h-8 border-2 border-white border-t-transparent rounded-full mx-auto mb-2" />
              <p className="text-sm">Requesting camera access...</p>
            </div>
          </div>
        )}
        {status === "denied" && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center text-white px-4">
              <div className="text-3xl mb-2">🚫</div>
              <p className="text-sm font-bold">Camera Access Denied</p>
              <p className="text-xs text-white/60 mt-1">Go to Settings → Safari → Camera and enable access for this site</p>
            </div>
          </div>
        )}
        {status === "unsupported" && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center text-white px-4">
              <div className="text-3xl mb-2">📷</div>
              <p className="text-sm font-bold">Camera Not Available</p>
              <p className="text-xs text-white/60 mt-1">Use manual entry below</p>
            </div>
          </div>
        )}

        {/* Scanned code feedback */}
        {lastScanned && (
          <div className="absolute bottom-4 left-4 right-4 text-center">
            <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-bold"
              style={{ backgroundColor: "#22c55e", color: "white" }}>
              ✓ {lastScanned}
            </span>
          </div>
        )}
      </div>

      {/* Manual entry fallback */}
      <p className="text-sm text-center" style={{ color: theme.textSecondary }}>
        Or type part number manually:
      </p>
      <div className="flex items-center gap-2">
        <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-xl border" style={{ borderColor: theme.cardBorder, backgroundColor: theme.cardBg }}>
          <Search className="w-4 h-4 text-slate-500" />
          <input className="flex-1 bg-transparent text-sm outline-none" style={{ color: theme.textPrimary }}
            placeholder="Type part number..." value={manualInput} onChange={e => setManualInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && manualInput.trim()) { onScan(manualInput.trim().toUpperCase()); } }} />
        </div>
        <button onClick={() => { if (manualInput.trim()) onScan(manualInput.trim().toUpperCase()); }}
          className="px-4 py-2 rounded-xl text-sm font-bold text-white"
          style={{ backgroundColor: "#6366f1", opacity: manualInput.trim() ? 1 : 0.4 }}>
          Go
        </button>
      </div>
    </div>
  );
}

// ── Rotating witty stockout messages (modal display) ──
const STOCKOUT_QUIPS = [
  "🫠 Well, this is awkward... Some parts apparently decided to ghost us. We checked the shelves, behind the shelves, even under the shelves — nothing. Maybe they eloped. Maybe they're on a beach somewhere sipping tiny umbrella drinks.",
  "🕵️ Missing parts detected! We've launched a full investigation. Current suspects: the shelf gnomes, a rogue forklift, and Dave from second shift who 'didn't touch anything.'",
  "🏖️ Some parts have clearly gone on vacation without filing PTO. If you see a J-part sunbathing in Cancún, please ask it to come home.",
  "🚀 Houston, we have a problem. Somewhere between the warehouse and this screen, parts vanished into thin air. We blame quantum physics. Or maybe the cleaning crew. Probably quantum physics.",
  "🎩 And for our next magic trick... we made your parts disappear! Unfortunately, nobody here knows how to bring them back. We're accepting applications for warehouse magicians.",
  "🍕 BREAKING NEWS: Parts missing from inventory. In completely unrelated news, the vending machine in the break room now dispenses 'Motor Assembly, Stepper w/ Gea' flavored snacks.",
  "📡 We pinged the parts. They left us on read. We tried calling. Straight to voicemail. At this point we're pretty sure they've moved on and are seeing another warehouse.",
  "🦖 Fun fact: these parts were last seen in the Jurassic era of our inventory system. Paleontologists have been called. Estimated recovery: 65 million years.",
  "🎪 Step right up, step right up! Witness the AMAZING DISAPPEARING INVENTORY ACT! No refunds. Management is not responsible for stress-induced snacking.",
  "🧙 A wizard did it. That's our official explanation. Either that or the parts achieved sentience and decided they didn't want to be installed today.",
  "👻 These parts are officially ghosts now. They haunt aisle 3 every full moon, rattling their part numbers and moaning about unfulfilled orders.",
  "🏃 Plot twist: the parts didn't go missing — they went on a journey of self-discovery. They'll be back when they find themselves. Or when Joe reorders. Whichever comes first.",
  "🎰 You've hit the inventory jackpot! ...wait, no. The opposite of that. You've hit the inventory bankruptcy. Sorry, the house always wins.",
  "🐔 Why did the part cross the road? To get to the other warehouse, apparently. It didn't leave a forwarding address.",
  "🧊 These parts are frozen in carbonite somewhere. We've dispatched Han Solo, but he's also missing. This is getting out of hand.",
];

// ── Rotating witty email openers (for the "Hey Joe" email) ──
const EMAIL_OPENERS = [
  "Houston, we have a problem. You went to pull a kit and several parts have gone completely AWOL. We filed a missing parts report. We checked the security cameras. We even asked the forklift. Nobody's talking.",
  "So... this is uncomfortable. We tried to pull a kit and the shelves just stared back at us. Empty. Cold. Judgmental. The parts have left the building.",
  "Bad news: your kit is on a diet — it's missing a few key ingredients. We've looked everywhere. Under the bench. Behind the cabinet. In Gary's lunch box. Nothing.",
  "Alert! Some parts have apparently formed a union and walked off the job. Their demands are unclear. Negotiations have stalled. Please send reinforcements.",
  "We regret to inform you that certain parts have gone full Bermuda Triangle on us. One minute they were here. The next — poof. Gone. No note. No forwarding address.",
  "Well, this is embarrassing. We went to build a kit and discovered our shelves have been... redecorated. By which we mean emptied. Completely. It's very minimalist now.",
  "Code Red in the warehouse! Several parts have gone rogue. Last seen heading east on the conveyor belt. If spotted, do not approach — they may be armed with tiny screwdrivers.",
  "Plot twist: the parts aren't missing, they're just fashionably late. Extremely fashionably late. Like, we-might-need-to-reorder late.",
];

// ── Rotating witty email closers ──
const EMAIL_CLOSERS = [
  "On behalf of every empty shelf in the building, we sincerely apologize. We're not saying the parts ran away from home, but if you see J-series components hitchhiking on I-95, please let us know.",
  "We've notified the shelves that they need to do a better job of holding onto things. They seem indifferent. Typical.",
  "In our defense, the inventory system DID try to warn us. We just thought it was being dramatic. Turns out it was being accurate. Our bad.",
  "We've filed a formal complaint with gravity for not keeping these parts on the shelves. Still waiting on a response.",
  "The good news: we found the problem. The bad news: the problem is that we don't have parts. We're working on it.",
  "We blame supply chain issues, solar flares, and Mercury retrograde — in that order.",
];

// ── Rotating P.S. lines ──
const EMAIL_PS = [
  'P.S. — We considered putting up "MISSING" posters in the break room, but HR said no.',
  "P.S. — If these parts show up in someone's trunk at the next company picnic, we're not asking questions.",
  "P.S. — The warehouse cat has been interrogated. She's not talking either.",
  "P.S. — We've started a support group for empty shelves. Meetings are Tuesdays at 3pm.",
  "P.S. — No parts were harmed in the making of this report. Mostly because we couldn't find them.",
  "P.S. — This email was generated automatically, but the disappointment is 100% organic and hand-crafted.",
  "P.S. — We tried to blame this on a software glitch, but the software has receipts.",
  "P.S. — The parts have been added to the FBI's Most Wanted list. Just kidding. But also not kidding.",
];

const pickRandom = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)];

type Mode = "OUT" | "IN" | "ADJUST" | "RECEIVE";

const MODES: { mode: Mode; icon: string; label: string; color: string; desc: string }[] = [
  { mode: "OUT", icon: "📤", label: "Stock Out", color: "#ef4444", desc: "Remove parts from inventory" },
  { mode: "IN", icon: "📥", label: "Stock In", color: "#22c55e", desc: "Return parts to inventory" },
  { mode: "ADJUST", icon: "🔧", label: "Adjust", color: "#f59e0b", desc: "Correct inventory counts" },
  { mode: "RECEIVE", icon: "📦", label: "Receive", color: "#6366f1", desc: "Log new deliveries" },
];

interface BatchItem {
  partNumber: string;
  description: string;
  qty: number;
  currentQoh: number;
}

export function ScanKiosk() {
  const data = useConvexData();
  const [mode, setMode] = useState<Mode | null>(null);
  const [employeeId, setEmployeeId] = useState("");
  const [analyzerSerial, setAnalyzerSerial] = useState("");
  const [showScanner, setShowScanner] = useState(false);
  const [partSearch, setPartSearch] = useState("");
  const [selectedPart, setSelectedPart] = useState<any>(null);
  const [qty, setQty] = useState(1);
  const [batch, setBatch] = useState<BatchItem[]>([]);
  const [committing, setCommitting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [showHowItWorks, setShowHowItWorks] = useState(false);
  const [kitPreview, setKitPreview] = useState<any>(null); // kit being previewed before consume
  const [stockoutReport, setStockoutReport] = useState<any>(null); // stockout report after commit

  const activeEmployees = data.employees.filter(e => e.active);

  const searchResults = useMemo(() => {
    if (!partSearch || partSearch.length < 2) return [];
    const q = partSearch.toLowerCase();
    return data.parts.filter(p =>
      p.partNumber.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q)
    ).slice(0, 8);
  }, [data.parts, partSearch]);

  const addToBatch = () => {
    if (!selectedPart) return;
    setBatch(prev => {
      const existing = prev.findIndex(b => b.partNumber === selectedPart.partNumber);
      if (existing >= 0) {
        const updated = [...prev];
        updated[existing].qty += qty;
        return updated;
      }
      return [...prev, {
        partNumber: selectedPart.partNumber,
        description: selectedPart.description,
        qty,
        currentQoh: selectedPart.qoh,
      }];
    });
    setSelectedPart(null);
    setPartSearch("");
    setQty(1);
  };

  const removeBatchItem = (idx: number) => {
    setBatch(prev => prev.filter((_, i) => i !== idx));
  };

  const commitBatch = async () => {
    if (!mode || batch.length === 0) return;
    setCommitting(true);
    try {
      const shortItems: { partNumber: string; description: string; need: number; had: number; short: number }[] = [];
      let consumedCount = 0;
      let stockoutCount = 0;

      for (const item of batch) {
        if (mode === "OUT") {
          const currentPart = data.parts.find(p => p.partNumber.toLowerCase() === item.partNumber.toLowerCase());
          const currentQoh = currentPart?.qoh ?? item.currentQoh;
          const canConsume = Math.min(item.qty, currentQoh); // Only consume what's on hand
          const shortQty = item.qty - canConsume;

          // 1) Consume what we actually have (partial or full)
          if (canConsume > 0) {
            await data.scanPart("OUT", item.partNumber, canConsume, employeeId, analyzerSerial || undefined);
            consumedCount++;
          }

          // 2) Log STOCKOUT for what we don't have — traceability only, no inventory impact
          if (shortQty > 0) {
            await data.scanPart("STOCKOUT", item.partNumber, shortQty, employeeId, analyzerSerial || undefined);
            stockoutCount++;
            shortItems.push({
              partNumber: item.partNumber,
              description: item.description,
              need: item.qty,
              had: currentQoh,
              short: shortQty,
            });
          }
        } else {
          // IN / RECEIVE / ADJUST — normal flow
          const actualQty = Math.abs(item.qty);
          await data.scanPart(mode, item.partNumber, actualQty, employeeId, analyzerSerial || undefined);
          consumedCount++;
        }
      }

      if (shortItems.length > 0) {
        const totalShort = shortItems.reduce((s, i) => s + i.short, 0);
        setStockoutReport({ items: shortItems, totalShort });
      }

      const parts = [];
      if (consumedCount > 0) parts.push(`${consumedCount} consumed`);
      if (stockoutCount > 0) parts.push(`${stockoutCount} stockout${stockoutCount > 1 ? "s" : ""} logged`);
      setResult(`✅ ${parts.join(", ")} — inventory never went negative`);
      setBatch([]);
    } catch (e) {
      setResult(`❌ ${e instanceof Error ? e.message : "Failed to commit"}`);
    }
    setCommitting(false);
  };

  // Download stockout report as .xlsx (Excel-compatible HTML table)
  const downloadStockoutXlsx = () => {
    if (!stockoutReport) return;
    const rows = stockoutReport.items.map((i: any) =>
      `<tr><td>${i.partNumber}</td><td>${i.description}</td><td>${i.need}</td><td>${i.had}</td><td>${i.short}</td><td>${i.had === 0 ? "FULL STOCKOUT" : "PARTIAL"}</td></tr>`
    ).join("");
    const html = `
      <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
      <head><meta charset="UTF-8"><!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet>
      <x:Name>Stockout Report</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>
      </x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]--></head><body>
      <table border="1">
        <tr><th colspan="6" style="font-size:16px;font-weight:bold;background:#f97316;color:white;">Stockout Report — ${new Date().toLocaleDateString()}</th></tr>
        <tr><th>Part #</th><th>Description</th><th>Needed</th><th>Had</th><th>Short</th><th>Status</th></tr>
        ${rows}
        <tr><td colspan="4" style="font-weight:bold;">Total Short</td><td colspan="2" style="font-weight:bold;color:red;">${stockoutReport.totalShort}</td></tr>
      </table></body></html>`;
    const blob = new Blob([html], { type: "application/vnd.ms-excel" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Stockout_Report_${new Date().toISOString().slice(0, 10)}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Build the email body (shared between both email buttons)
  const buildStockoutEmail = (recipientName: string) => {
    if (!stockoutReport) return { subject: "", body: "" };
    const itemLines = stockoutReport.items.map((i: any) => {
      const isFullStockout = i.had === 0;
      return `• ${i.partNumber} — ${i.description}\nNeeded: ${i.need} | Had: ${i.had} | Short: ${i.short}${isFullStockout ? " 🔴 FULL STOCKOUT" : " 🟡 PARTIAL"}`;
    }).join("\n\n");

    const opener = pickRandom(EMAIL_OPENERS);
    const closer = pickRandom(EMAIL_CLOSERS);
    const ps = pickRandom(EMAIL_PS);

    const subject = encodeURIComponent(`Stockout Alert — Your Kit Is Missing a Few Friends 🫠`);
    const body = encodeURIComponent(
      `Hey ${recipientName},\n\n` +
      `${opener}\n\n` +
      `Here's what's MIA:\n\n` +
      `${itemLines}\n\n` +
      `Total pieces short: ${stockoutReport.totalShort}\n\n` +
      `${closer}\n\n` +
      `A restock order has been flagged. In the meantime, if you need an alternative or expedite, just holler.\n\n` +
      `Regards,\nVITROS Inventory Team 🔧\n\n` +
      `${ps}`
    );
    return { subject, body };
  };

  // Email the employee who was consuming
  const emailEmployee = () => {
    const emp = activeEmployees.find(e => e._id === employeeId);
    const firstName = emp?.name?.split(" ")[0] || "Team";
    const emailAddr = emp?.email || "";
    if (!emailAddr) { alert("No email on file for this employee"); return; }
    const { subject, body } = buildStockoutEmail(firstName);
    window.open(`mailto:${emailAddr}?subject=${subject}&body=${body}`, "_blank");
  };

  // Email Joe (always)
  const emailJoe = () => {
    const { subject, body } = buildStockoutEmail("Joe");
    window.open(`mailto:Joe.willis@quidelortho.com?subject=${subject}&body=${body}`, "_blank");
  };

  const consumeKit = (kitId: string) => {
    const kit = data.kits.find(k => k.kitId === kitId);
    if (!kit) return;
    // Show preview instead of immediately adding
    setKitPreview(kit);
  };

  const confirmKitConsume = () => {
    if (!kitPreview) return;
    const items: BatchItem[] = kitPreview.components.map((comp: any) => ({
      partNumber: comp.partNumber,
      description: comp.description || data.parts.find((p: any) => p.partNumber === comp.partNumber)?.description || "",
      qty: comp.qtyRequired,
      currentQoh: data.parts.find((p: any) => p.partNumber === comp.partNumber)?.qoh || 0,
    }));
    setBatch(prev => [...prev, ...items]);
    setMode("OUT");
    setKitPreview(null);
  };

  // KIT PREVIEW MODAL
  if (kitPreview) {
    const previewComponents = kitPreview.components.map((comp: any) => {
      const part = data.parts.find((p: any) => p.partNumber === comp.partNumber);
      const qoh = part?.qoh ?? 0;
      const missing = qoh < comp.qtyRequired;
      return { ...comp, qoh, missing, description: comp.description || part?.description || "" };
    });
    const missingCount = previewComponents.filter((c: any) => c.missing).length;

    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <button onClick={() => setKitPreview(null)} className="p-2 rounded-xl" style={{ backgroundColor: theme.cardBg }}>
            <X className="w-5 h-5" style={{ color: theme.textPrimary }} />
          </button>
          <div className="flex-1">
            <h2 className="text-lg font-bold" style={{ color: theme.textPrimary }}>📦 {kitPreview.name}</h2>
            <p className="text-xs" style={{ color: theme.textSecondary }}>{kitPreview.components.length} components · {kitPreview.basePartNumber}</p>
          </div>
        </div>

        {missingCount > 0 && (
          <div className="px-4 py-2.5 rounded-xl text-sm flex items-center gap-2"
            style={{ backgroundColor: "#ef444420", color: "#ef4444", border: "1px solid #ef444440" }}>
            <span>⚠️</span>
            <span><strong>{missingCount}</strong> part{missingCount > 1 ? "s" : ""} with insufficient stock</span>
          </div>
        )}

        <WebCard className="overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b" style={{ borderColor: theme.cardBorder }}>
            <span className="text-xs font-bold" style={{ color: theme.textSecondary }}>PART</span>
            <div className="flex gap-8 text-xs font-bold" style={{ color: theme.textSecondary }}>
              <span className="w-12 text-center">NEED</span>
              <span className="w-12 text-center">QOH</span>
            </div>
          </div>
          <div className="divide-y max-h-[60vh] overflow-y-auto" style={{ borderColor: theme.cardBorder }}>
            {previewComponents.map((comp: any, i: number) => (
              <div key={i} className="flex items-center gap-3 px-4 py-2.5"
                style={{
                  backgroundColor: comp.missing ? "#ef444415" : "transparent",
                  borderLeft: comp.missing ? "3px solid #ef4444" : "3px solid transparent",
                }}>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium" style={{ color: comp.missing ? "#ef4444" : "#6366f1" }}>{comp.partNumber}</div>
                  <div className="text-[10px] truncate" style={{ color: comp.missing ? "#ef444499" : theme.textMuted }}>{comp.description}</div>
                </div>
                <div className="flex gap-8 shrink-0">
                  <span className="w-12 text-center text-sm font-bold" style={{ color: theme.textPrimary }}>{comp.qtyRequired}</span>
                  <span className="w-12 text-center text-sm font-bold" style={{ color: comp.missing ? "#ef4444" : theme.statusOk }}>{comp.qoh}</span>
                </div>
              </div>
            ))}
          </div>
        </WebCard>

        {/* Employee & Analyzer fields — required before consuming */}
        <WebCard className="p-4 space-y-3">
          <div>
            <label className="text-[10px] font-semibold" style={{ color: theme.textSecondary }}>Employee *</label>
            <select className="w-full mt-1 px-3 py-2 rounded-xl text-sm border appearance-none"
              style={{ borderColor: !employeeId ? "#ef4444" : theme.cardBorder, backgroundColor: "#111827", color: theme.textPrimary }}
              value={employeeId} onChange={e => setEmployeeId(e.target.value)}>
              <option value="">Select employee...</option>
              {activeEmployees.map(e => (
                <option key={e._id} value={e._id}>{e.name} ({e.initials})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-semibold" style={{ color: theme.textSecondary }}>Analyzer Serial # *</label>
            <input className="w-full mt-1 px-3 py-2 rounded-xl text-sm border"
              style={{ borderColor: !analyzerSerial ? "#ef4444" : theme.cardBorder, backgroundColor: "#111827", color: theme.textPrimary }}
              placeholder="Enter analyzer serial number..." value={analyzerSerial} onChange={e => setAnalyzerSerial(e.target.value)} />
          </div>
          {(!employeeId || !analyzerSerial) && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg" style={{ backgroundColor: "#ef444415" }}>
              <span style={{ color: "#ef4444" }}>⚠️</span>
              <span className="text-xs" style={{ color: "#ef4444" }}>
                {!employeeId && !analyzerSerial ? "Employee and Analyzer Serial # required" :
                 !employeeId ? "Employee required" : "Analyzer Serial # required"}
              </span>
            </div>
          )}
        </WebCard>

        <div className="grid grid-cols-2 gap-3">
          <button onClick={() => setKitPreview(null)}
            className="py-3 rounded-xl text-sm font-bold border"
            style={{ borderColor: theme.cardBorder, color: theme.textSecondary }}>
            Cancel
          </button>
          <button onClick={confirmKitConsume}
            disabled={!employeeId || !analyzerSerial}
            className="py-3 rounded-xl text-sm font-bold text-white disabled:opacity-40"
            style={{ backgroundColor: "#6366f1" }}>
            Consume Kit ({kitPreview.components.length})
          </button>
        </div>
      </div>
    );
  }

  // MODE SELECTION
  if (!mode) {
    return (
      <div className="space-y-4">
        <div className="text-center py-4">
          <div className="text-4xl mb-2">📷</div>
          <h2 className="text-xl font-bold" style={{ color: theme.textPrimary }}>Scan Kiosk</h2>
          <p className="text-sm mt-1" style={{ color: theme.textSecondary }}>Choose a transaction mode to get started</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {MODES.map(m => (
            <button key={m.mode} onClick={() => setMode(m.mode)}
              className="rounded-2xl p-4 text-left transition-all hover:scale-[1.02]"
              style={{ backgroundColor: theme.cardBg, border: `1px solid ${theme.cardBorder}` }}>
              <div className="text-3xl mb-2">{m.icon}</div>
              <div className="text-sm font-bold" style={{ color: m.color }}>{m.label}</div>
              <div className="text-[10px] mt-0.5" style={{ color: theme.textMuted }}>{m.desc}</div>
            </button>
          ))}
        </div>

        {/* Consume Kit — prominent button */}
        {data.kits.length > 0 && (
          <WebCard className="p-4">
            <h3 className="text-sm font-bold mb-3" style={{ color: theme.textPrimary }}>🔧 Consume Kit</h3>
            {data.kits.map((kit: any) => (
              <button key={kit.kitId} onClick={() => consumeKit(kit.kitId)}
                className="w-full flex items-center gap-3 py-3 px-3 mb-2 last:mb-0 rounded-xl text-left transition-all hover:scale-[1.01]"
                style={{ backgroundColor: "#6366f115", border: "1px solid #6366f140" }}>
                <span className="text-2xl">📦</span>
                <div className="flex-1">
                  <div className="text-sm font-bold" style={{ color: theme.textPrimary }}>{kit.name}</div>
                  <div className="text-[10px]" style={{ color: theme.textMuted }}>{kit.components.length} components · {kit.basePartNumber}</div>
                </div>
                <ChevronRight className="w-5 h-5" style={{ color: "#6366f1" }} />
              </button>
            ))}
          </WebCard>
        )}

        {/* How it works */}
        <WebCard className="p-4">
          <button onClick={() => setShowHowItWorks(!showHowItWorks)} className="w-full text-left">
            <h3 className="text-sm font-bold" style={{ color: theme.textPrimary }}>
              ❓ How it Works {showHowItWorks ? "▲" : "▼"}
            </h3>
          </button>
          {showHowItWorks && (
            <div className="mt-3 space-y-2 text-xs" style={{ color: theme.textSecondary }}>
              <p><strong style={{ color: theme.textPrimary }}>1. Choose a mode</strong> — OUT removes parts, IN returns them, ADJUST corrects counts, RECEIVE logs deliveries.</p>
              <p><strong style={{ color: theme.textPrimary }}>2. Select employee</strong> — Ties all scans to a person for accountability.</p>
              <p><strong style={{ color: theme.textPrimary }}>3. Scan or search</strong> — Use the camera to scan barcodes or search by part number.</p>
              <p><strong style={{ color: theme.textPrimary }}>4. Build batch</strong> — Add multiple parts before committing.</p>
              <p><strong style={{ color: theme.textPrimary }}>5. Commit</strong> — All items are processed at once and logged to SAP staging.</p>
            </div>
          )}
        </WebCard>
      </div>
    );
  }

  const currentMode = MODES.find(m => m.mode === mode)!;

  // CAMERA SCANNER VIEW — uses real camera + BarcodeDetector API
  if (showScanner) {
    const handleBarcodeScan = (code: string) => {
      // Look up the scanned code against known parts
      const match = data.parts.find(p =>
        p.partNumber.toUpperCase() === code.toUpperCase() ||
        p.partNumber.toUpperCase().includes(code.toUpperCase()) ||
        code.toUpperCase().includes(p.partNumber.toUpperCase())
      );
      if (match) {
        setSelectedPart(match);
        setPartSearch(match.partNumber);
      } else {
        setPartSearch(code);
      }
      setShowScanner(false);
    };

    return <WebBarcodeScanner onScan={handleBarcodeScan} onClose={() => setShowScanner(false)} />;
  }

  // MAIN SCAN VIEW
  return (
    <div className="space-y-4">
      {/* Mode header */}
      <div className="flex items-center gap-3">
        <button onClick={() => { setMode(null); setBatch([]); setResult(null); }}
          className="p-2 rounded-xl" style={{ backgroundColor: theme.cardBg }}>
          <RotateCcw className="w-4 h-4" style={{ color: theme.textPrimary }} />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xl">{currentMode.icon}</span>
            <h2 className="text-lg font-bold" style={{ color: currentMode.color }}>{currentMode.label}</h2>
          </div>
        </div>
        <StatusBadge text={mode} color={currentMode.color} />
      </div>

      {/* Employee & Analyzer */}
      <WebCard className="p-4 space-y-3">
        <div>
          <label className="text-[10px] font-semibold" style={{ color: theme.textSecondary }}>Employee *</label>
          <select className="w-full mt-1 px-3 py-2 rounded-xl text-sm border appearance-none"
            style={{ borderColor: theme.cardBorder, backgroundColor: "#111827", color: theme.textPrimary }}
            value={employeeId} onChange={e => setEmployeeId(e.target.value)}>
            <option value="">Select employee...</option>
            {activeEmployees.map(e => (
              <option key={e._id} value={e._id}>{e.name} ({e.initials})</option>
            ))}
          </select>
        </div>
        {mode === "OUT" && (
          <div>
            <label className="text-[10px] font-semibold" style={{ color: theme.textSecondary }}>Analyzer Serial # (required for OUT)</label>
            <input className="w-full mt-1 px-3 py-2 rounded-xl text-sm border"
              style={{ borderColor: !analyzerSerial ? "#ef4444" : theme.cardBorder, backgroundColor: "#111827", color: theme.textPrimary }}
              placeholder="Enter analyzer serial number..." value={analyzerSerial} onChange={e => setAnalyzerSerial(e.target.value)} />
            {!analyzerSerial && (
              <div className="flex items-center gap-1.5 mt-1.5 px-3 py-1.5 rounded-lg" style={{ backgroundColor: "#ef444415" }}>
                <span style={{ color: "#ef4444" }}>⚠️</span>
                <span className="text-xs" style={{ color: "#ef4444" }}>Analyzer Serial # is required for OUT transactions. Every part pulled must be tied to an analyzer.</span>
              </div>
            )}
          </div>
        )}
      </WebCard>

      {/* Scan buttons */}
      <div className="grid grid-cols-2 gap-3">
        <button onClick={() => setShowScanner(true)}
          className="flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold text-white"
          style={{ backgroundColor: "#6366f1" }}>
          <Camera className="w-4 h-4" /> Open Scanner
        </button>
        <button onClick={() => document.getElementById("part-search-input")?.focus()}
          className="flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold border"
          style={{ borderColor: theme.cardBorder, color: theme.textSecondary }}>
          <Search className="w-4 h-4" /> Look Up Part
        </button>
      </div>

      {/* Part search */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-xl border" style={{ borderColor: theme.cardBorder, backgroundColor: theme.cardBg }}>
        <Search className="w-4 h-4 text-slate-500" />
        <input id="part-search-input" className="flex-1 bg-transparent text-sm outline-none" style={{ color: theme.textPrimary }}
          placeholder="Search by part number or description..." value={partSearch} onChange={e => { setPartSearch(e.target.value); setSelectedPart(null); }} />
        {partSearch && <button onClick={() => { setPartSearch(""); setSelectedPart(null); }}><X className="w-4 h-4 text-slate-500" /></button>}
      </div>

      {/* Search results */}
      {searchResults.length > 0 && !selectedPart && (
        <WebCard className="overflow-hidden">
          <div className="divide-y" style={{ borderColor: theme.cardBorder }}>
            {searchResults.map(p => (
              <button key={p._id} onClick={() => { setSelectedPart(p); setPartSearch(p.partNumber); }}
                className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.03] text-left">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium" style={{ color: "#6366f1" }}>{p.partNumber}</div>
                  <div className="text-xs" style={{ color: theme.textSecondary }}>{p.description}</div>
                </div>
                <div className="text-right">
                  <StatusBadge text={p.status} color={statusColor(p.status)} />
                  <div className="text-[10px] mt-0.5" style={{ color: theme.textMuted }}>QOH: {p.qoh}</div>
                </div>
              </button>
            ))}
          </div>
        </WebCard>
      )}

      {/* Selected part + quantity */}
      {selectedPart && (
        <WebCard className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <StatusBadge text={selectedPart.status} color={statusColor(selectedPart.status)} />
            <span className="text-sm font-bold" style={{ color: theme.textPrimary }}>{selectedPart.partNumber}</span>
          </div>
          <div className="text-xs mb-3" style={{ color: theme.textSecondary }}>{selectedPart.description}</div>
          <div className="flex items-center gap-4 mb-3">
            <span className="text-xs" style={{ color: theme.textMuted }}>Current QOH: {selectedPart.qoh}</span>
            <span className="text-xs" style={{ color: theme.textMuted }}>Min: {selectedPart.minQty}</span>
            <span className="text-xs" style={{ color: theme.textMuted }}>Max: {selectedPart.maxQty}</span>
          </div>

          {/* Quantity selector */}
          <div className="flex items-center justify-center gap-4">
            <button onClick={() => setQty(Math.max(1, qty - 1))} className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ backgroundColor: theme.cardBg, border: `1px solid ${theme.cardBorder}` }}>
              <Minus className="w-4 h-4" style={{ color: theme.textPrimary }} />
            </button>
            <input type="number" value={qty} onChange={e => setQty(Math.max(1, parseInt(e.target.value) || 1))}
              className="w-16 text-center text-xl font-bold rounded-xl py-1 border"
              style={{ borderColor: theme.cardBorder, backgroundColor: "#111827", color: theme.textPrimary }} />
            <button onClick={() => setQty(qty + 1)} className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ backgroundColor: theme.cardBg, border: `1px solid ${theme.cardBorder}` }}>
              <Plus className="w-4 h-4" style={{ color: theme.textPrimary }} />
            </button>
          </div>

          <button onClick={addToBatch} className="w-full mt-3 py-2.5 rounded-xl text-sm font-bold text-white"
            style={{ backgroundColor: currentMode.color }}>
            Add {qty} to Batch
          </button>
        </WebCard>
      )}

      {/* Current Batch */}
      <WebCard className="overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: theme.cardBorder }}>
          <h3 className="text-sm font-bold" style={{ color: theme.textPrimary }}>Current Batch</h3>
          <span className="text-[10px] font-bold" style={{ color: currentMode.color }}>{batch.length} items</span>
        </div>
        {batch.length === 0 ? (
          <div className="py-6 text-center">
            <div className="text-2xl opacity-30 mb-1">📷</div>
            <div className="text-xs" style={{ color: theme.textSecondary }}>Scan or search to add parts</div>
          </div>
        ) : (
          <>
            <div className="divide-y" style={{ borderColor: theme.cardBorder }}>
              {batch.map((item, i) => {
                const insufficient = mode === "OUT" && item.currentQoh < item.qty;
                return (
                  <div key={i} className="flex items-center gap-3 px-4 py-2.5"
                    style={{
                      backgroundColor: insufficient ? "#ef444415" : "transparent",
                      borderLeft: insufficient ? "3px solid #ef4444" : "3px solid transparent",
                    }}>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium" style={{ color: insufficient ? "#ef4444" : theme.textPrimary }}>{item.partNumber}</div>
                      <div className="text-[10px]" style={{ color: insufficient ? "#ef444499" : theme.textMuted }}>
                        {item.description}
                        {insufficient && <span className="ml-1 font-bold"> · QOH: {item.currentQoh}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => setBatch(prev => prev.map((b, j) => j === i ? { ...b, qty: Math.max(1, b.qty - 1) } : b))}
                        className="w-7 h-7 rounded-lg flex items-center justify-center border"
                        style={{ borderColor: theme.cardBorder, backgroundColor: theme.cardBg }}>
                        <Minus className="w-3 h-3" style={{ color: theme.textPrimary }} />
                      </button>
                      <span className="text-sm font-bold w-6 text-center" style={{ color: mode === "OUT" ? theme.statusOut : theme.statusOk }}>
                        {item.qty}
                      </span>
                      <button onClick={() => setBatch(prev => prev.map((b, j) => j === i ? { ...b, qty: b.qty + 1 } : b))}
                        className="w-7 h-7 rounded-lg flex items-center justify-center border"
                        style={{ borderColor: theme.cardBorder, backgroundColor: theme.cardBg }}>
                        <Plus className="w-3 h-3" style={{ color: theme.textPrimary }} />
                      </button>
                    </div>
                    <button onClick={() => removeBatchItem(i)} className="p-1 rounded-lg hover:bg-red-500/10">
                      <X className="w-4 h-4" style={{ color: "#ef4444" }} />
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="p-4">
              <button onClick={commitBatch} disabled={committing || !employeeId || (mode === "OUT" && !analyzerSerial)}
                className="w-full py-3 rounded-xl text-sm font-bold text-white disabled:opacity-40"
                style={{ backgroundColor: currentMode.color }}>
                {committing ? "Processing..." : `Commit Batch (${batch.length} items)`}
              </button>
              {!employeeId && <div className="text-[10px] text-center mt-1" style={{ color: theme.statusOut }}>Select employee first</div>}
              {mode === "OUT" && !analyzerSerial && <div className="text-[10px] text-center mt-1" style={{ color: theme.statusOut }}>Enter analyzer serial # to commit</div>}
            </div>
          </>
        )}
      </WebCard>

      {/* Result */}
      {result && (
        <div className="px-4 py-3 rounded-xl text-sm" style={{
          backgroundColor: result.startsWith("✅") ? theme.statusOk + "15" : theme.statusOut + "15",
          color: result.startsWith("✅") ? theme.statusOk : theme.statusOut,
        }}>
          {result}
        </div>
      )}

      {/* Stockout Report Modal */}
      {stockoutReport && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.6)" }}>
          <div className="w-full max-w-lg rounded-t-3xl sm:rounded-2xl overflow-hidden" style={{ backgroundColor: theme.pageBg }}>
            {/* Header */}
            <div className="px-5 pt-5 pb-4 relative" style={{ background: "linear-gradient(135deg, #ef4444, #f97316)" }}>
              <button onClick={() => setStockoutReport(null)} className="absolute top-4 right-4 p-1 rounded-full bg-white/20">
                <X className="w-5 h-5 text-white" />
              </button>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
                  <span className="text-xl">⚠️</span>
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white">Stockout Report</h3>
                  <p className="text-sm text-white/80">{stockoutReport.items.length} item{stockoutReport.items.length > 1 ? "s" : ""} short · {stockoutReport.totalShort} total pieces unavailable</p>
                </div>
              </div>
            </div>

            {/* Rotating witty message */}
            <div className="px-5 py-3" style={{ backgroundColor: "#fefce8", borderBottom: "1px solid #fde68a" }}>
              <p className="text-sm italic" style={{ color: "#92400e" }}>
                {pickRandom(STOCKOUT_QUIPS)}
              </p>
            </div>

            {/* Table */}
            <div className="px-5 py-3">
              <div className="flex gap-2 text-[10px] font-bold pb-2 border-b" style={{ color: theme.textSecondary, borderColor: theme.cardBorder }}>
                <span className="flex-1">Part #</span>
                <span className="flex-1">Description</span>
                <span className="w-10 text-center">Need</span>
                <span className="w-10 text-center">Had</span>
                <span className="w-12 text-center">Short</span>
              </div>
              <div className="max-h-48 overflow-y-auto divide-y" style={{ borderColor: theme.cardBorder }}>
                {stockoutReport.items.map((item: any, i: number) => (
                  <div key={i} className="flex gap-2 items-center py-2 text-xs">
                    <span className="flex-1 font-bold" style={{ color: theme.textPrimary }}>{item.partNumber}</span>
                    <span className="flex-1 truncate" style={{ color: theme.textSecondary }}>{item.description}</span>
                    <span className="w-10 text-center font-bold" style={{ color: theme.textPrimary }}>{item.need}</span>
                    <span className="w-10 text-center" style={{ color: theme.textSecondary }}>{item.had}</span>
                    <span className="w-12 text-center font-bold px-1.5 py-0.5 rounded-full" style={{ backgroundColor: "#ef444420", color: "#ef4444" }}>-{item.short}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Actions — Download, Email Employee, Email Joe */}
            <div className="px-5 pb-5 pt-2 flex flex-col gap-2">
              <button onClick={downloadStockoutXlsx}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold text-white"
                style={{ backgroundColor: "#22c55e" }}>
                📥 Download .xlsx
              </button>
              <div className="flex gap-3">
                <button onClick={emailEmployee}
                  className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold text-white"
                  style={{ backgroundColor: "#3b82f6" }}>
                  ✉️ Email {activeEmployees.find(e => e._id === employeeId)?.name?.split(" ")[0] || "Employee"}
                </button>
                <button onClick={emailJoe}
                  className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold text-white"
                  style={{ backgroundColor: "#6366f1" }}>
                  ✉️ Email Joe
                </button>
              </div>
              <button onClick={() => setStockoutReport(null)}
                className="w-full py-2.5 rounded-xl text-sm font-medium"
                style={{ color: theme.textSecondary }}>
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
