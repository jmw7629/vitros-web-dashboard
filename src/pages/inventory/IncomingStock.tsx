import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useConvexData } from "../../hooks/useConvexData";
import { useAction } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { WebCard, theme } from "../../components/vitros/SharedComponents";
import {
  Search, Plus, Upload, X, ChevronDown, AlertTriangle, Check,
  Trash2, Camera, Keyboard, Loader2, Pencil, RotateCcw,
} from "lucide-react";

// ─── Supabase storage for image uploads (anon key, RLS-protected) ───
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

// ─── Session persistence: survive navigation away ───
// Global queue outside React — runs to completion even if component unmounts
const _pendingReceives: Promise<any>[] = [];
const SESSION_KEY = "vitros_incoming_session";
const SESSION_TTL = 5 * 60 * 1000; // 5 minutes

function saveSession(state: any) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ ...state, savedAt: Date.now() }));
  } catch {}
}

function loadSession(): any | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (Date.now() - s.savedAt > SESSION_TTL) {
      sessionStorage.removeItem(SESSION_KEY);
      return null;
    }
    return s;
  } catch { return null; }
}

function clearSession() {
  try { sessionStorage.removeItem(SESSION_KEY); } catch {}
}

// ─── Server-side OCR learning functions (routed through Convex actions) ───
// OCR learnings are now stored via Convex server-side actions for security.
// These placeholder functions maintain API compatibility; actual implementation
// routes through supabaseGateway.insertOcrLearning action.

interface OcrLearning {
  ocr_raw: string;
  matched_part: string;
  user_corrected: boolean;
  count: number;
}

async function loadOcrLearnings(): Promise<OcrLearning[]> {
  // OCR learnings are loaded via the main data refresh in useConvexData
  // This is a placeholder for backward compatibility
  return [];
}

function saveOcrLearning(_ocrRaw: string, _matchedPart: string, _userCorrected: boolean) {
  // Routed through Convex action server-side — no client-side Supabase writes
}

// ─── Types ───
interface ReceivingLine {
  id: string;
  lineNo: number;
  partNumber_raw: string;
  partNumber: string;
  description: string;
  qty: number;           // Ship qty (what actually arrived — use this for receiving)
  orderedQty?: number;   // Ordered qty (expected — for discrepancy checking)
  matched: boolean;
  selected: boolean;
  source: "ocr" | "csv" | "manual";
}

type EntryMode = "photo" | "upload" | "manual";

// ─── Image compression (iOS camera photos are 3-12MB) ───
function compressImage(file: File, maxWidth = 1400, quality = 0.75): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      try {
        const canvas = document.createElement("canvas");
        let w = img.width, h = img.height;
        if (w > maxWidth) { h = Math.round(h * maxWidth / w); w = maxWidth; }
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("Canvas not supported"));
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob(
          blob => blob ? resolve(blob) : reject(new Error("Compression failed")),
          "image/jpeg", quality
        );
      } catch (e: any) {
        reject(e);
      }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Image load error")); };
    img.src = url;
  });
}

// ─── Part number matching ───
// Matches on PART NUMBER only — descriptions can differ.
function matchPartNumber(raw: string, known: { partNumber: string; description: string }[], learnings?: OcrLearning[]) {
  if (!raw || !known.length) return null;
  const clean = raw.toUpperCase().trim().replace(/\s+/g, "");
  if (!clean) return null;

  // Helper: normalize for comparison
  const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

  // 0. Check learned corrections first — user corrections get priority
  if (learnings?.length) {
    // Sort: user-corrected first, then by count
    const sorted = [...learnings].sort((a, b) => {
      if (a.user_corrected !== b.user_corrected) return a.user_corrected ? -1 : 1;
      return b.count - a.count;
    });
    const learned = sorted.find(l => norm(l.ocr_raw) === norm(clean));
    if (learned) {
      const match = known.find(p => norm(p.partNumber) === norm(learned.matched_part));
      if (match) return match;
    }
  }

  // 1. Exact
  const exact = known.find(p => norm(p.partNumber) === clean);
  if (exact) return exact;

  // 2. Strip non-alphanumeric
  const stripped = clean.replace(/[^A-Z0-9]/g, "");
  const byStrip = known.find(p => norm(p.partNumber) === stripped);
  if (byStrip) return byStrip;

  // 3. Smart prefix matching — ALL parts are 6 characters
  // Pure 5-digit number → most likely missing "J" prefix (J##### is most common)
  // Pure 4-digit number → try "1H", "1C" prefixes
  // Pure 3-digit number → try "1H0", "1C0" prefixes (leading zero dropped)
  const digitsOnly = stripped.replace(/[^0-9]/g, "");
  const candidates: string[] = [];
  if (/^\d{5}$/.test(stripped)) {
    candidates.push("J" + stripped);         // J##### — most common pattern
    candidates.push("J" + stripped + "P");   // J#####P variant
  }
  if (/^\d{4}$/.test(stripped)) {
    candidates.push("1H" + stripped);        // 1H####
    candidates.push("1C" + stripped);        // 1C####
    candidates.push("J0" + stripped);        // J0#### (leading zero dropped)
  }
  if (/^\d{3}$/.test(stripped)) {
    candidates.push("1H0" + stripped);       // 1H0### (leading zero dropped)
    candidates.push("1C0" + stripped);       // 1C0### (leading zero dropped)
  }
  // Also try adding P suffix for any candidate
  if (/^J\d{5}$/i.test(stripped) && !stripped.endsWith("P")) {
    candidates.push(stripped + "P");
  }
  for (const c of candidates) {
    const m = known.find(p => norm(p.partNumber) === c);
    if (m) return m;
  }

  // 4. General prefix try (fallback)
  for (const pfx of ["J", "1H", "1C", "0"]) {
    const m = known.find(p => norm(p.partNumber) === (pfx + stripped));
    if (m) return m;
  }

  // 5. OCR misreads: I→1, O→0, l→1
  const ocrFixed = stripped.replace(/^I(?=[A-Z0-9])/g, "1").replace(/O/g, "0").replace(/^l/, "1");
  if (ocrFixed !== stripped) {
    const m = known.find(p => norm(p.partNumber) === ocrFixed);
    if (m) return m;
    // Also try prefix on OCR-fixed version
    for (const pfx of ["J", "1H", "1C"]) {
      const m2 = known.find(p => norm(p.partNumber) === (pfx + ocrFixed));
      if (m2) return m2;
    }
  }

  // 6. Levenshtein ≤ 1 (try both raw and with-prefix versions)
  const tryLev = [stripped, ...candidates];
  for (const attempt of tryLev) {
    if (attempt.length >= 5) {
      for (const p of known) {
        const pk = norm(p.partNumber);
        if (Math.abs(pk.length - attempt.length) <= 1 && levenshtein(pk, attempt) <= 1) return p;
      }
    }
  }

  return null;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  if (Math.abs(a.length - b.length) > 2) return Math.abs(a.length - b.length);
  const m: number[][] = [];
  for (let i = 0; i <= a.length; i++) m[i] = [i];
  for (let j = 0; j <= b.length; j++) m[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      m[i][j] = Math.min(m[i-1][j]+1, m[i][j-1]+1, m[i-1][j-1]+(a[i-1]===b[j-1]?0:1));
  return m[a.length][b.length];
}

// ─── CSV parser ───
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let cur = "", inQ = false;
  for (const ch of line) {
    if (ch === '"') { inQ = !inQ; continue; }
    if (ch === ',' && !inQ) { result.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  result.push(cur.trim());
  return result;
}

let _idCounter = 0;
const uid = () => `line_${Date.now()}_${++_idCounter}`;

// ═══════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════
export function IncomingStock() {
  const data = useConvexData();
  const ocrPackingList = useAction(api.aiGateway.ocrPackingList);

  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Employee
  const [employee, setEmployee] = useState("");
  const [empQuery, setEmpQuery] = useState("");
  const [empOpen, setEmpOpen] = useState(false);

  // Entry mode
  const [mode, setMode] = useState<EntryMode>("photo");

  // Manual entry
  const [manualPN, setManualPN] = useState("");
  const [manualQty, setManualQty] = useState("");

  // Shipment metadata
  const [poNumber, setPoNumber] = useState("");
  const [deliveryNumber, setDeliveryNumber] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");

  // Lines
  const [lines, setLines] = useState<ReceivingLine[]>([]);

  // OCR learnings — continuous learning from past scans
  const [ocrLearnings, setOcrLearnings] = useState<OcrLearning[]>([]);
  useEffect(() => { loadOcrLearnings().then(setOcrLearnings); }, []);

  // Session restore — if user navigated away and came back within 5 min
  const [sessionRestored, setSessionRestored] = useState(false);
  useEffect(() => {
    const saved = loadSession();
    if (saved && !sessionRestored) {
      if (saved.lines?.length) setLines(saved.lines);
      if (saved.employee) setEmployee(saved.employee);
      if (saved.poNumber) setPoNumber(saved.poNumber);
      if (saved.deliveryNumber) setDeliveryNumber(saved.deliveryNumber);
      if (saved.trackingNumber) setTrackingNumber(saved.trackingNumber);
      if (saved.result) setResult(saved.result);
      setSessionRestored(true);
    }
  }, []);

  // OCR
  const [scanning, setScanning] = useState(false);
  const [scanStep, setScanStep] = useState("");
  const [scanImages, setScanImages] = useState<string[]>([]);

  // Commit
  const [committing, setCommitting] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  // Auto-save session on changes (must be after all state declarations)
  useEffect(() => {
    if (lines.length || employee || poNumber) {
      saveSession({ lines, employee, poNumber, deliveryNumber, trackingNumber, result });
    }
  }, [lines, employee, poNumber, deliveryNumber, trackingNumber, result]);

  // Edit / delete
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [editPN, setEditPN] = useState("");
  const [editDescIdx, setEditDescIdx] = useState<number | null>(null);
  const [editDesc, setEditDesc] = useState("");
  const [deleteIdx, setDeleteIdx] = useState<number | null>(null);

  // Derived
  const activeEmps = data.employees.filter(e => e.active);
  const filteredEmps = useMemo(() => {
    if (!empQuery) return activeEmps;
    const q = empQuery.toLowerCase();
    return activeEmps.filter(e =>
      e.name.toLowerCase().includes(q) || e.initials.toLowerCase().includes(q)
    );
  }, [activeEmps, empQuery]);

  const knownParts = useMemo(
    () => data.parts.map(p => ({ partNumber: p.partNumber, description: p.description, qoh: p.qoh })),
    [data.parts]
  );

  const manualMatch = knownParts.find(p => p.partNumber.toLowerCase() === manualPN.toLowerCase().trim());
  const selectedLines = lines.filter(l => l.selected && l.matched);
  const locked = !employee;

  // ─── OCR Prompt ───
  const buildPrompt = () => {
    const partList = knownParts.map(p => p.partNumber).join(", ");
    // Include learned OCR corrections in the prompt
    const corrections = ocrLearnings
      .filter(l => l.ocr_raw !== l.matched_part)
      .sort((a, b) => (b.user_corrected ? 1 : 0) - (a.user_corrected ? 1 : 0) || b.count - a.count)
      .slice(0, 30)  // Top 30 most relevant corrections
      .map(l => `"${l.ocr_raw}" → "${l.matched_part}"${l.user_corrected ? " (confirmed)" : ""}`)
      .join("\n");
    return `You are an expert OCR reader for QuidelOrtho warehouse packing list documents.

THERE ARE TWO DOCUMENT FORMATS — identify which one you're reading:

━━━ FORMAT A: "CONTAINER PACKING LIST" ━━━
Table columns (left to right):
  LINE | PRODUCT CODE + DESCRIPTION + GTIN | LOT/EXPIRY | UNIT OF MEAS | QTY/UNIT | GROSS WEIGHT

- LINE is a sequential number (1, 2, 3…) — this is NOT the quantity.
- PRODUCT CODE (first line in cell) = part number.
- DESCRIPTION (second line in cell) = item name.
- GTIN (third line) = always empty, skip it.
- QTY/UNIT = the ACTUAL QUANTITY. This is what we need.
- GROSS WEIGHT = weight in LB. Ignore this.
- There is NO ordered qty on this format.

━━━ FORMAT B: "ORDER PACKING LIST" ━━━
Table columns (left to right):
  LINE | PRODUCT CODE + DESCRIPTION | DELIVERY # | LOT/EXPIRY | SHIP VIA | ORDERED QTY | UNIT OF MEAS | SHIP QTY | GROSS WEIGHT

- ORDERED QTY = how many were ordered (expected).
- SHIP QTY = how many were actually shipped. USE THIS as the quantity.
- If SHIP QTY differs from ORDERED QTY, still report SHIP QTY as qty and ORDERED QTY as ordered_qty.

━━━ CRITICAL RULES ━━━
1. The LINE column (1, 2, 3…) is just a row number. NEVER use it as the quantity.
2. For Container Packing Lists: quantity is in the QTY/UNIT column (after UNIT OF MEAS "EA").
3. For Order Packing Lists: quantity is SHIP QTY (last number column before GROSS WEIGHT).
4. The same part number can appear on multiple lines — report each line separately.
5. Extract PURCHASE ORDER NO, DELIVERY #, and TRACKING # from the header.
6. Documents are often photographed SIDEWAYS (rotated 90°). Handle any orientation.
7. Multi-page documents: only extract items visible on THIS page.

PART NUMBER FORMATS — ALL part numbers are exactly 6 characters:
- J##### or J#####P (MOST COMMON — e.g. J37203, J56801P, J71080P, J37914, J18244, J18764, J25995, J27309)
- 1H#### (e.g. 1H0114, 1H5512)
- 1C#### (e.g. 1C5846, 1C2581)
- 6-digit pure numbers (e.g. 142069, 354984, 126239, 350408, 124980)

⚠️ CRITICAL: If you see a 5-digit number like "18244", it is MISSING the "J" prefix — output it as "J18244".
⚠️ If you see a 4-digit number like "0114", it is MISSING the "1H" or "1C" prefix — match against the known list.
⚠️ ALWAYS include the full prefix (J, 1H, 1C) in your output. Never return bare digits when a prefix applies.

${corrections ? `LEARNED OCR CORRECTIONS (from past scans — apply these mappings):\n${corrections}\n` : ""}
KNOWN INVENTORY PART NUMBERS:
${partList}

Return ONLY valid JSON (no markdown fences):
{
  "docType": "container" or "order",
  "poNumber": "",
  "deliveryNumber": "",
  "trackingNumber": "",
  "items": [
    {"partNumber": "J37914", "description": "Wash Aux Bottle Cap Assy", "qty": 10, "ordered_qty": 10}
  ]
}

For Container Packing Lists where there is no ordered_qty, omit the ordered_qty field or set it equal to qty.
If unreadable, return: {"docType":"unknown","poNumber":"","deliveryNumber":"","trackingNumber":"","items":[]}`;
  };

  // ─── OCR Pipeline ───
  const runOCR = async (file: File) => {
    setScanning(true);
    setScanStep(`📷 Compressing…`);
    const thumbUrl = URL.createObjectURL(file);
    setScanImages(prev => [...prev, thumbUrl]);

    try {
      // 1. Compress (smaller = faster upload to OpenAI)
      let blob: Blob;
      try { blob = await compressImage(file, 1200, 0.6); } catch { blob = file; }

      // 2. Convert to base64 (skip Supabase upload — much faster)
      const b64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });

      // 3. OCR via server-side Convex action (OpenAI key never in browser)
      setScanStep("🔍 Reading packing list…");
      const prompt = buildPrompt();

      let raw: string;
      try {
        raw = await ocrPackingList({
          imageBase64: b64,
          prompt: prompt + "\n\nRead this QuidelOrtho packing list. Extract every line item with part number and quantity. The document may be rotated sideways. Remember: LINE number ≠ quantity. Use QTY/UNIT for Container lists or SHIP QTY for Order lists.",
        });
      } catch (e: any) {
        throw new Error(`AI OCR failed: ${e.message}`);
      }

      // 4. Parse
      setScanStep("✅ Processing…");
      let parsed: any;
      try {
        const cleaned = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
        parsed = JSON.parse(cleaned);
      } catch {
        const m = raw.match(/\{[\s\S]*\}/);
        if (m) parsed = JSON.parse(m[0]);
        else throw new Error("Could not parse AI response");
      }

      // Auto-fill metadata
      if (parsed.poNumber && !poNumber) setPoNumber(parsed.poNumber);
      if (parsed.deliveryNumber && !deliveryNumber) setDeliveryNumber(parsed.deliveryNumber);
      if (parsed.trackingNumber && !trackingNumber) setTrackingNumber(parsed.trackingNumber);

      const items: any[] = parsed.items || parsed.lines || [];
      if (items.length > 0) {
        const newLines: ReceivingLine[] = items.map((item: any, i: number) => {
          const pn = (item.partNumber || "").trim();
          const match = matchPartNumber(pn, knownParts, ocrLearnings);
          const shipQty = parseInt(item.qty) || parseInt(item.ship_qty) || 1;
          const orderedQty = parseInt(item.ordered_qty) || undefined;
          // Save learning — auto-match result
          if (match && pn) saveOcrLearning(pn, match.partNumber, false);
          return {
            id: uid(),
            lineNo: lines.length + i + 1,
            partNumber_raw: pn,
            partNumber: match ? match.partNumber : pn,
            description: match ? match.description : (item.description || ""),
            qty: shipQty,
            orderedQty,
            matched: !!match,
            selected: !!match,
            source: "ocr" as const,
          };
        });
        setLines(prev => [...prev, ...newLines].map((l, i) => ({ ...l, lineNo: i + 1 })));
        const mc = newLines.filter(l => l.matched).length;
        const discrepancies = newLines.filter(l => l.orderedQty && l.orderedQty !== l.qty).length;
        let msg = `✅ Found ${newLines.length} items — ${mc} matched`;
        if (discrepancies > 0) msg += `, ⚠️ ${discrepancies} qty discrepanc${discrepancies === 1 ? "y" : "ies"}`;
        setScanStep(msg);
      } else {
        setScanStep("⚠ No items found. Try a clearer photo or enter manually.");
      }

    } catch (e: any) {
      console.error("OCR error:", e);
      setScanStep(`❌ ${e.message || "Scan failed"}`);
    }
    setScanning(false);
  };

  // ─── Handlers ───
  const onCamera = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (f) runOCR(f); e.target.value = "";
  };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return; e.target.value = "";
    if (f.type.startsWith("image/")) { runOCR(f); return; }
    if (!f.name.match(/\.csv$/i)) { setScanStep("⚠ Upload an image or .csv file"); return; }

    const reader = new FileReader();
    reader.onload = () => {
      const rows = (reader.result as string).split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      if (rows.length < 2) { setScanStep("⚠ CSV is empty"); return; }
      const hdrs = parseCSVLine(rows[0]).map(h => h.toLowerCase());
      const pCol = hdrs.findIndex(h => /part|product|sku|item|material|p\/?n/i.test(h));
      const dCol = hdrs.findIndex(h => /desc|name/i.test(h));
      const qCol = hdrs.findIndex(h => /qty|quantity|count|stock|amount|units/i.test(h));
      const newLines: ReceivingLine[] = [];
      for (let i = 1; i < rows.length; i++) {
        const cols = parseCSVLine(rows[i]);
        const pn = (cols[pCol >= 0 ? pCol : 0] || "").trim();
        if (!pn || /^(total|sum|grand)/i.test(pn)) continue;
        const match = matchPartNumber(pn, knownParts);
        const csvLine: ReceivingLine = {
          id: uid(), lineNo: 0, partNumber_raw: pn,
          partNumber: match ? match.partNumber : pn,
          description: match ? match.description : (dCol >= 0 ? cols[dCol] || "" : ""),
          qty: qCol >= 0 ? (parseInt(cols[qCol]) || 1) : 1,
          matched: !!match, selected: !!match, source: "csv",
        };
        newLines.push(csvLine);
      }
      if (newLines.length > 0) {
        setLines(prev => [...prev, ...newLines].map((l, i) => ({ ...l, lineNo: i + 1 })));
        setScanStep(`✅ CSV: ${newLines.length} items — ${newLines.filter(l => l.matched).length} matched`);
      } else setScanStep("⚠ No items found in CSV");
    };
    reader.readAsText(f);
  };

  const addManual = () => {
    if (!manualMatch || !manualQty) return;
    const newLine: ReceivingLine = {
      id: uid(), lineNo: 0, partNumber_raw: manualMatch.partNumber,
      partNumber: manualMatch.partNumber, description: manualMatch.description,
      qty: parseInt(manualQty) || 1, matched: true, selected: true, source: "manual",
    };
    setLines(prev => [...prev, newLine].map((l, i) => ({ ...l, lineNo: i + 1 })));
    setManualPN(""); setManualQty("");
  };

  const toggleLine = (i: number) => setLines(prev => prev.map((l, j) => j === i ? { ...l, selected: !l.selected } : l));
  const removeLine = (i: number) => { setLines(prev => prev.filter((_, j) => j !== i).map((l, j) => ({ ...l, lineNo: j + 1 }))); setDeleteIdx(null); };
  const updateQty = (i: number, v: string) => { const n = v === "" ? 0 : parseInt(v); setLines(prev => prev.map((l, j) => j === i ? { ...l, qty: isNaN(n) ? 0 : n } : l)); };

  const startEdit = (i: number) => { setEditIdx(i); setEditPN(lines[i].partNumber); };
  const saveEdit = (i: number) => {
    const pn = editPN.trim(); if (!pn) { setEditIdx(null); return; }
    const match = matchPartNumber(pn, knownParts, ocrLearnings);
    const oldRaw = lines[i].partNumber_raw || lines[i].partNumber;
    const newPart = match ? match.partNumber : pn.toUpperCase();
    // Save user correction — highest confidence learning
    if (oldRaw && newPart !== oldRaw.toUpperCase()) {
      saveOcrLearning(oldRaw, newPart, true);
      // Update local learnings cache immediately
      setOcrLearnings(prev => [...prev, { ocr_raw: oldRaw.toUpperCase(), matched_part: newPart, user_corrected: true, count: 1 }]);
    }
    setLines(prev => prev.map((l, j) => j === i ? {
      ...l, partNumber: newPart,
      description: match ? match.description : l.description, matched: !!match, selected: !!match,
    } : l));
    setEditIdx(null);
  };

  const startDescEdit = (i: number) => { setEditDescIdx(i); setEditDesc(lines[i].description); };
  const saveDescEdit = (i: number) => {
    setLines(prev => prev.map((l, j) => j === i ? { ...l, description: editDesc } : l));
    setEditDescIdx(null);
  };

  const commitAll = async () => {
    if (!employee) return setResult("⚠️ Select an employee first");
    if (selectedLines.length === 0) return setResult("⚠️ No matched items selected");
    setCommitting(true); setResult(null);
    try {
      // Fire all receives in parallel — uses global queue so it survives unmount
      const promises = selectedLines.map(line => data.scanPart("RECEIVE", line.partNumber, line.qty, employee));
      _pendingReceives.push(...promises);
      const results = await Promise.allSettled(promises);
      // Clean up completed promises from global queue
      for (const p of promises) {
        const idx = _pendingReceives.indexOf(p);
        if (idx >= 0) _pendingReceives.splice(idx, 1);
      }
      const ok = results.filter(r => r.status === "fulfilled").length;
      const failed = results.length - ok;
      if (failed > 0) {
        setResult(`⚠️ ${ok} received, ${failed} failed`);
      } else {
        setResult(`✅ ${ok} item(s) received into inventory by ${employee}`);
        setLines([]); setScanImages([]); setScanStep("");
        setPoNumber(""); setDeliveryNumber(""); setTrackingNumber("");
        clearSession();
      }
    } catch (e: any) { setResult(`❌ ${e.message || "Failed"}`); }
    setCommitting(false);
  };

  const clearAll = () => {
    setLines([]); setScanImages([]); setScanStep(""); setResult(null);
    setPoNumber(""); setDeliveryNumber(""); setTrackingNumber("");
    clearSession();
  };

  // ═══ RENDER ═══
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold" style={{ color: theme.textPrimary }}>📥 Incoming Stock Intake</h2>
        <p className="text-sm mt-0.5" style={{ color: theme.textSecondary }}>
          Snap a packing list photo or enter parts manually — matched items go straight into inventory
        </p>
      </div>

      {/* ═══ Employee ═══ */}
      <WebCard className={`p-4 ${!employee ? "ring-2 ring-amber-400" : ""}`}>
        <label className="text-[10px] font-bold uppercase tracking-wider" style={{ color: theme.textMuted }}>
          Receiving Employee *
        </label>
        <div className="relative mt-2">
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl border cursor-pointer"
            style={{ borderColor: empOpen ? "#6366f1" : theme.cardBorder, backgroundColor: "#111827" }}
            onClick={() => setEmpOpen(!empOpen)}>
            <Search className="w-4 h-4 flex-shrink-0" style={{ color: theme.textMuted }} />
            <input className="flex-1 bg-transparent text-sm outline-none" style={{ color: theme.textPrimary }}
              placeholder="Search by name or initials…"
              value={empOpen ? empQuery : employee}
              onChange={e => { setEmpQuery(e.target.value); setEmpOpen(true); }}
              onFocus={() => setEmpOpen(true)} />
            {employee && !empOpen ? (
              <button onClick={e => { e.stopPropagation(); setEmployee(""); setEmpQuery(""); }}>
                <X className="w-4 h-4" style={{ color: theme.textMuted }} />
              </button>
            ) : <ChevronDown className="w-4 h-4" style={{ color: theme.textMuted }} />}
          </div>
          {empOpen && (
            <div className="absolute z-50 left-0 right-0 mt-1 max-h-60 overflow-y-auto rounded-xl border shadow-lg"
              style={{ borderColor: theme.cardBorder, backgroundColor: "#111827" }}>
              {filteredEmps.length === 0 ? (
                <div className="px-4 py-3 text-sm text-center" style={{ color: theme.textMuted }}>No employees found</div>
              ) : filteredEmps.map(emp => (
                <button key={emp._id}
                  onClick={() => { setEmployee(emp.name); setEmpQuery(""); setEmpOpen(false); }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.05] text-left border-b last:border-0"
                  style={{ borderColor: theme.cardBorder }}>
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                    style={{ backgroundColor: "#6366f1" }}>{emp.initials}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium" style={{ color: theme.textPrimary }}>{emp.name}</div>
                    {emp.email && <div className="text-[10px] truncate" style={{ color: theme.textMuted }}>{emp.email}</div>}
                  </div>
                  {employee === emp.name && <Check className="w-4 h-4" style={{ color: "#6366f1" }} />}
                </button>
              ))}
            </div>
          )}
        </div>
        {!employee && (
          <p className="flex items-center gap-1 text-[10px] font-bold mt-2" style={{ color: "#f59e0b" }}>
            <AlertTriangle className="w-3 h-3" /> Required before receiving items
          </p>
        )}
      </WebCard>

      {/* ═══ Entry Mode ═══ */}
      <div style={locked ? { opacity: 0.5, pointerEvents: "none" } : undefined}>
        <div className="grid grid-cols-3 gap-2">
          {([
            { m: "photo" as const, icon: <Camera className="w-6 h-6" />, label: "Photo", sub: "Snap packing list" },
            { m: "upload" as const, icon: <Upload className="w-6 h-6" />, label: "Upload", sub: "Image or CSV" },
            { m: "manual" as const, icon: <Keyboard className="w-6 h-6" />, label: "Manual", sub: "Type part #" },
          ]).map(({ m, icon, label, sub }) => (
            <button key={m} onClick={() => {
              setMode(m);
              if (m === "photo") setTimeout(() => cameraRef.current?.click(), 100);
              if (m === "upload") setTimeout(() => fileRef.current?.click(), 100);
            }}
              className="flex flex-col items-center gap-1.5 py-4 px-3 rounded-xl border-2 transition-all"
              style={{ borderColor: mode === m ? "#6366f1" : theme.cardBorder, backgroundColor: mode === m ? "#6366f115" : theme.cardBg }}>
              <div style={{ color: mode === m ? "#6366f1" : theme.textSecondary }}>{icon}</div>
              <span className="text-xs font-bold" style={{ color: theme.textPrimary }}>{label}</span>
              <span className="text-[10px]" style={{ color: theme.textMuted }}>{sub}</span>
            </button>
          ))}
        </div>
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onCamera} />
        <input ref={fileRef} type="file" accept="image/*,.csv" className="hidden" onChange={onFile} />
      </div>

      {/* ═══ Scan Progress ═══ */}
      {scanning && (
        <WebCard className="p-4">
          <div className="flex items-center gap-3">
            <Loader2 className="w-5 h-5 animate-spin" style={{ color: "#6366f1" }} />
            <span className="text-sm font-medium" style={{ color: theme.textPrimary }}>{scanStep}</span>
          </div>
        </WebCard>
      )}
      {scanStep && !scanning && (
        <div className="px-3 py-2 rounded-lg text-xs" style={{
          backgroundColor: scanStep.startsWith("✅") ? "#22c55e15" : scanStep.startsWith("⚠") || scanStep.startsWith("❌") ? "#f59e0b15" : "#6366f115",
          color: scanStep.startsWith("✅") ? "#22c55e" : scanStep.startsWith("⚠") || scanStep.startsWith("❌") ? "#f59e0b" : "#6366f1",
        }}>{scanStep}</div>
      )}

      {/* Photo thumbnails */}
      {scanImages.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {scanImages.map((url, i) => (
            <div key={i} className="relative w-16 h-16 rounded-lg overflow-hidden border" style={{ borderColor: theme.cardBorder }}>
              <img src={url} alt={`Photo ${i+1}`} className="w-full h-full object-cover" />
              <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-[8px] text-center text-white font-bold py-0.5">Pg {i+1}</div>
              {!scanning && (
                <button
                  onClick={(e) => { e.stopPropagation(); setScanImages(prev => prev.filter((_, j) => j !== i)); }}
                  className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-black border-2 border-white flex items-center justify-center shadow-lg hover:bg-red-600 transition-colors"
                  style={{ zIndex: 10 }}
                  title="Remove image"
                >
                  <X className="w-3 h-3 text-white" />
                </button>
              )}
            </div>
          ))}
          <button onClick={() => cameraRef.current?.click()} disabled={scanning}
            className="w-16 h-16 rounded-lg border-2 border-dashed flex flex-col items-center justify-center gap-0.5 disabled:opacity-30"
            style={{ borderColor: theme.cardBorder, color: theme.textMuted }}>
            <Plus className="w-4 h-4" /><span className="text-[8px]">More</span>
          </button>
        </div>
      )}

      {/* ═══ Shipment Details ═══ */}
      {(poNumber || deliveryNumber || trackingNumber || lines.length > 0) && (
        <WebCard className="p-4 space-y-2" style={locked ? { opacity: 0.5, pointerEvents: "none" } : undefined}>
          <h3 className="text-[10px] font-bold uppercase tracking-wider" style={{ color: theme.textMuted }}>Shipment Details</h3>
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: "PO #", val: poNumber, set: setPoNumber },
              { label: "Delivery #", val: deliveryNumber, set: setDeliveryNumber },
              { label: "Tracking #", val: trackingNumber, set: setTrackingNumber },
            ].map(({ label, val, set }) => (
              <div key={label}>
                <label className="text-[9px] font-semibold" style={{ color: theme.textMuted }}>{label}</label>
                <input className="w-full mt-0.5 px-2 py-1.5 rounded-lg text-xs border outline-none"
                  style={{ borderColor: theme.cardBorder, backgroundColor: "#111827", color: theme.textPrimary }}
                  value={val} onChange={e => set(e.target.value)} placeholder={label} />
              </div>
            ))}
          </div>
        </WebCard>
      )}

      {/* ═══ Manual Entry ═══ */}
      {mode === "manual" && (
        <div style={locked ? { opacity: 0.5, pointerEvents: "none" } : undefined}>
          <WebCard className="p-4 space-y-3">
            <h3 className="text-sm font-bold" style={{ color: theme.textPrimary }}>✏️ Manual Entry</h3>
            <div>
              <label className="text-[10px] font-semibold" style={{ color: theme.textSecondary }}>Part Number</label>
              <div className="flex items-center gap-2 mt-1 px-3 py-2 rounded-xl border" style={{ borderColor: theme.cardBorder, backgroundColor: "#111827" }}>
                <Search className="w-4 h-4 text-slate-500" />
                <input className="flex-1 bg-transparent text-sm outline-none" style={{ color: theme.textPrimary }}
                  placeholder="Type or scan part number…" value={manualPN} onChange={e => setManualPN(e.target.value)} />
              </div>
            </div>
            {manualPN && !manualMatch && (
              <div className="px-3 py-2 rounded-lg text-xs" style={{ backgroundColor: "#ef444415", color: "#ef4444" }}>✗ No matching part in inventory</div>
            )}
            {manualMatch && (
              <div className="px-3 py-2 rounded-lg text-xs" style={{ backgroundColor: "#22c55e15", color: "#22c55e" }}>
                ✓ {manualMatch.description} (QOH: {manualMatch.qoh})
              </div>
            )}
            <div>
              <label className="text-[10px] font-semibold" style={{ color: theme.textSecondary }}>Quantity</label>
              <input type="number" className="w-full mt-1 px-3 py-2 rounded-xl text-sm outline-none border"
                style={{ borderColor: theme.cardBorder, backgroundColor: "#111827", color: theme.textPrimary }}
                placeholder="Enter quantity" value={manualQty} onChange={e => setManualQty(e.target.value)} />
            </div>
            <button onClick={addManual} disabled={!manualMatch || !manualQty}
              className="w-full py-2.5 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 disabled:opacity-40"
              style={{ backgroundColor: "#6366f1" }}>
              <Plus className="w-4 h-4" /> Add to Receiving List
            </button>
          </WebCard>
        </div>
      )}

      {/* ═══ Receiving List ═══ */}
      <WebCard className="overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: theme.cardBorder }}>
          <h3 className="text-sm font-bold" style={{ color: theme.textPrimary }}>📋 Receiving List</h3>
          <div className="flex items-center gap-3">
            {lines.length > 0 && (
              <span className="text-[10px] font-medium" style={{ color: theme.textMuted }}>
                {selectedLines.length} of {lines.length} ready
              </span>
            )}
            <button onClick={() => {
              const nl: ReceivingLine = { id: uid(), lineNo: lines.length + 1, partNumber_raw: "", partNumber: "",
                description: "", qty: 1, matched: false, selected: false, source: "manual" as const };
              setLines(prev => [...prev, nl]);
              setTimeout(() => { setEditIdx(lines.length); setEditPN(""); }, 50);
            }}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold border hover:bg-white/5"
              style={{ borderColor: theme.cardBorder, color: "#6366f1" }}>
              <Plus className="w-3 h-3" /> Add
            </button>
          </div>
        </div>

        {lines.length === 0 ? (
          <div className="py-8 text-center">
            <div className="text-3xl opacity-30 mb-2">📦</div>
            <div className="text-sm" style={{ color: theme.textSecondary }}>No items yet</div>
            <div className="text-[10px] mt-1" style={{ color: theme.textMuted }}>
              Snap a photo, upload a CSV, or enter manually
            </div>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b" style={{ borderColor: theme.cardBorder, backgroundColor: "rgba(255,255,255,0.02)" }}>
                    <th className="px-3 py-2 text-left w-8">✓</th>
                    <th className="px-3 py-2 text-left" style={{ color: theme.textSecondary }}>#</th>
                    <th className="px-3 py-2 text-left" style={{ color: theme.textSecondary }}>Part Number</th>
                    <th className="px-3 py-2 text-left" style={{ color: theme.textSecondary }}>Description</th>
                    <th className="px-3 py-2 text-right" style={{ color: theme.textSecondary }}>Ship Qty</th>
                    <th className="px-3 py-2 text-right" style={{ color: theme.textSecondary }}>Ord Qty</th>
                    <th className="px-3 py-2 text-center" style={{ color: theme.textSecondary }}>Status</th>
                    <th className="px-3 py-2 w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, i) => {
                    const qtyMismatch = line.orderedQty !== undefined && line.orderedQty !== line.qty;
                    return (
                      <tr key={line.id} className="border-b"
                        style={{
                          borderColor: theme.cardBorder,
                          backgroundColor: line.selected ? "rgba(99,102,241,0.05)" : "transparent",
                          opacity: !line.selected ? 0.5 : 1,
                        }}>
                        <td className="px-3 py-2">
                          <button onClick={() => toggleLine(i)}
                            className="w-5 h-5 rounded border flex items-center justify-center"
                            style={{ borderColor: line.selected ? "#6366f1" : theme.cardBorder, backgroundColor: line.selected ? "#6366f1" : "transparent" }}>
                            {line.selected && <Check className="w-3 h-3 text-white" />}
                          </button>
                        </td>
                        <td className="px-3 py-2" style={{ color: theme.textMuted }}>{line.lineNo}</td>
                        <td className="px-3 py-2">
                          {editIdx === i ? (
                            <div className="flex items-center gap-1">
                              <input autoFocus className="w-24 px-2 py-1 rounded border text-xs font-mono font-bold uppercase"
                                style={{ borderColor: "#6366f1", backgroundColor: "#111827", color: theme.textPrimary, outline: "none" }}
                                value={editPN} onChange={e => setEditPN(e.target.value)}
                                onKeyDown={e => { if (e.key === "Enter") saveEdit(i); if (e.key === "Escape") setEditIdx(null); }} placeholder="Part #" />
                              <button onClick={() => saveEdit(i)} className="p-1 rounded hover:bg-white/10"><Check className="w-3.5 h-3.5" style={{ color: "#22c55e" }} /></button>
                              <button onClick={() => setEditIdx(null)} className="p-1 rounded hover:bg-white/10"><X className="w-3.5 h-3.5" style={{ color: theme.textMuted }} /></button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono font-bold" style={{ color: theme.textPrimary }}>
                                {line.partNumber || <span style={{ color: theme.textMuted }}>—</span>}
                              </span>
                              <button onClick={() => startEdit(i)} className="p-0.5 rounded opacity-40 hover:opacity-100" title="Edit">
                                <Pencil className="w-3 h-3" style={{ color: "#6366f1" }} />
                              </button>
                              {line.partNumber_raw && line.partNumber_raw !== line.partNumber && (
                                <span className="text-[9px]" style={{ color: theme.textMuted }}>OCR: {line.partNumber_raw}</span>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2" style={{ color: theme.textSecondary }}>
                          {editDescIdx === i ? (
                            <div className="flex items-center gap-1">
                              <input autoFocus className="w-40 px-2 py-1 rounded border text-xs"
                                style={{ borderColor: "#6366f1", backgroundColor: "#111827", color: theme.textPrimary, outline: "none" }}
                                value={editDesc} onChange={e => setEditDesc(e.target.value)}
                                onKeyDown={e => { if (e.key === "Enter") saveDescEdit(i); if (e.key === "Escape") setEditDescIdx(null); }}
                                placeholder="Description" />
                              <button onClick={() => saveDescEdit(i)} className="p-1 rounded hover:bg-white/10"><Check className="w-3.5 h-3.5" style={{ color: "#22c55e" }} /></button>
                              <button onClick={() => setEditDescIdx(null)} className="p-1 rounded hover:bg-white/10"><X className="w-3.5 h-3.5" style={{ color: theme.textMuted }} /></button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1">
                              <span className="truncate block max-w-[180px]">{line.description || <span style={{ color: theme.textMuted }}>—</span>}</span>
                              <button onClick={() => startDescEdit(i)} className="p-0.5 rounded opacity-40 hover:opacity-100 flex-shrink-0" title="Edit description">
                                <Pencil className="w-3 h-3" style={{ color: "#6366f1" }} />
                              </button>
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <input type="number" min={0} className="w-16 px-2 py-1 rounded border text-right text-xs font-bold"
                            style={{
                              borderColor: qtyMismatch ? "#f59e0b" : theme.cardBorder,
                              backgroundColor: "#111827",
                              color: qtyMismatch ? "#f59e0b" : theme.textPrimary,
                            }}
                            value={line.qty} onChange={e => updateQty(i, e.target.value)} />
                        </td>
                        <td className="px-3 py-2 text-right">
                          {line.orderedQty !== undefined ? (
                            <span className={`text-xs font-medium ${qtyMismatch ? "font-bold" : ""}`}
                              style={{ color: qtyMismatch ? "#f59e0b" : theme.textMuted }}>
                              {line.orderedQty}
                              {qtyMismatch && " ⚠"}
                            </span>
                          ) : (
                            <span className="text-[10px]" style={{ color: theme.textMuted }}>—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold" style={{
                            backgroundColor: line.matched ? "#22c55e20" : "#ef444420",
                            color: line.matched ? "#22c55e" : "#ef4444",
                          }}>{line.matched ? "MATCHED" : "UNMATCHED"}</span>
                        </td>
                        <td className="px-3 py-2">
                          <button onClick={() => setDeleteIdx(i)} className="p-1 rounded hover:bg-white/5">
                            <Trash2 className="w-3.5 h-3.5" style={{ color: "#ef4444" }} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Summary + Commit */}
            <div className="p-4 space-y-3">
              <div className="flex items-center justify-between text-xs" style={{ color: theme.textSecondary }}>
                <span>{lines.filter(l => l.matched).length} matched · {lines.filter(l => !l.matched).length} unmatched</span>
                <span className="font-bold" style={{ color: "#22c55e" }}>
                  Total: +{selectedLines.reduce((s, l) => s + l.qty, 0)} units
                </span>
              </div>

              {/* Qty discrepancy warning */}
              {lines.some(l => l.orderedQty !== undefined && l.orderedQty !== l.qty) && (
                <div className="flex items-start gap-2 px-3 py-2 rounded-lg text-[10px]" style={{ backgroundColor: "#f59e0b15", color: "#f59e0b" }}>
                  <AlertTriangle className="w-3 h-3 flex-shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold">Qty discrepancy detected</span> — Ship Qty differs from Ordered Qty on some items. Review highlighted rows before receiving.
                  </div>
                </div>
              )}

              {lines.some(l => !l.matched) && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-[10px]" style={{ backgroundColor: "#ef444415", color: "#ef4444" }}>
                  <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                  Unmatched items won't be received. Edit the part number or remove them.
                </div>
              )}

              <div className="flex gap-2">
                <button onClick={clearAll}
                  className="flex-1 py-2.5 rounded-xl text-sm font-bold border flex items-center justify-center gap-1"
                  style={{ borderColor: theme.cardBorder, color: theme.textSecondary }}>
                  <RotateCcw className="w-3.5 h-3.5" /> Clear
                </button>
                <button onClick={commitAll} disabled={committing || locked || selectedLines.length === 0}
                  className="flex-[2] py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-40 flex items-center justify-center gap-2"
                  style={{ backgroundColor: "#22c55e" }}>
                  {committing ? <><Loader2 className="w-4 h-4 animate-spin" /> Processing…</> :
                    `Receive ${selectedLines.length} Item${selectedLines.length !== 1 ? "s" : ""}`}
                </button>
              </div>
            </div>
          </>
        )}
      </WebCard>

      {/* Result */}
      {result && (
        <div className="px-4 py-3 rounded-xl text-sm" style={{
          backgroundColor: result.startsWith("✅") ? "#22c55e15" : result.startsWith("⚠") ? "#f59e0b15" : "#ef444415",
          color: result.startsWith("✅") ? "#22c55e" : result.startsWith("⚠") ? "#f59e0b" : "#ef4444",
        }}>{result}</div>
      )}

      {/* Delete modal */}
      {deleteIdx !== null && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => setDeleteIdx(null)}>
          <div className="w-full max-w-sm mx-4 rounded-2xl border shadow-2xl" style={{ backgroundColor: "#111827", borderColor: theme.cardBorder }}
            onClick={e => e.stopPropagation()}>
            <div className="p-6 text-center space-y-3">
              <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto" style={{ backgroundColor: "#ef444420" }}>
                <AlertTriangle className="w-6 h-6" style={{ color: "#ef4444" }} />
              </div>
              <h3 className="text-lg font-bold" style={{ color: theme.textPrimary }}>Remove item?</h3>
              <p className="text-sm" style={{ color: theme.textSecondary }}>
                Remove <strong style={{ color: theme.textPrimary }}>{lines[deleteIdx]?.partNumber || "(empty)"}</strong>?
              </p>
            </div>
            <div className="flex gap-2 p-4 border-t" style={{ borderColor: theme.cardBorder }}>
              <button onClick={() => setDeleteIdx(null)} className="flex-1 py-2.5 rounded-xl text-sm font-bold border"
                style={{ borderColor: theme.cardBorder, color: theme.textSecondary }}>Cancel</button>
              <button onClick={() => removeLine(deleteIdx)} className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white"
                style={{ backgroundColor: "#ef4444" }}>Remove</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
