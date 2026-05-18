import { useState, useMemo, useRef } from "react";
import { useConvexData } from "../../hooks/useConvexData";
import { WebCard, StatusBadge, theme, downloadCSV } from "../../components/vitros/SharedComponents";
import { Search, Plus, Upload, X, ChevronDown, AlertTriangle, Check, Trash2, Camera, FileText, Keyboard, Loader2, Pencil } from "lucide-react";

interface BatchLine {
  lineNo: number;
  partNumber_OCR: string;
  partNumber_Final: string;
  description: string;
  qty: number;
  matchStatus: "MATCHED" | "UNMATCHED" | "PENDING";
  resolvedPartNumber?: string;
  isSelected: boolean;
  confidence: number;
}

type EntryMode = "photo" | "upload" | "manual";

/* ── Smart CSV parser ── */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (ch === ',' && !inQuotes) { result.push(current.trim()); current = ""; continue; }
    current += ch;
  }
  result.push(current.trim());
  return result;
}

/* ── Smart part number matching (LOOSE — if it matches, good to go) ── */
function smartMatchPart(ocrPN: string, knownParts: { partNumber: string; description: string }[]) {
  if (!ocrPN || knownParts.length === 0) return null;
  const up = ocrPN.toUpperCase().trim().replace(/\s+/g, "");
  if (!up) return null;

  // 1. Exact match
  const exact = knownParts.find(p => p.partNumber.toUpperCase() === up);
  if (exact) return exact;

  // 2. Strip ALL non-alphanumeric and compare
  const clean = up.replace(/[^A-Z0-9]/g, "");
  const byClean = knownParts.find(p => p.partNumber.toUpperCase().replace(/[^A-Z0-9]/g, "") === clean);
  if (byClean) return byClean;

  // 3. Try common prefixes: J, 1H, 0
  for (const prefix of ["J", "1H", "0"]) {
    const match = knownParts.find(p => p.partNumber.toUpperCase().replace(/[^A-Z0-9]/g, "") === (prefix + clean));
    if (match) return match;
  }

  // 4. Common OCR misreads: I→1, O→0, S→5, B→8, l→1, Z→2
  const ocrFixed = clean
    .replace(/^I(?=[A-Z0-9])/g, "1")
    .replace(/O/g, "0")
    .replace(/^[Il]/g, "1");
  if (ocrFixed !== clean) {
    const match = knownParts.find(p => p.partNumber.toUpperCase().replace(/[^A-Z0-9]/g, "") === ocrFixed);
    if (match) return match;
    for (const prefix of ["J", "1H"]) {
      const m2 = knownParts.find(p => p.partNumber.toUpperCase().replace(/[^A-Z0-9]/g, "") === (prefix + ocrFixed));
      if (m2) return m2;
    }
  }

  // 5. Substring/contains match — if clean has 4+ chars and is contained in a known part
  if (clean.length >= 4) {
    const match = knownParts.find(p => {
      const pk = p.partNumber.toUpperCase().replace(/[^A-Z0-9]/g, "");
      return pk.includes(clean) || clean.includes(pk);
    });
    if (match) return match;
  }

  // 6. Levenshtein distance ≤ 2 for short part numbers
  if (clean.length >= 3) {
    let bestMatch: typeof knownParts[0] | null = null;
    let bestDist = 3; // max acceptable distance
    for (const p of knownParts) {
      const pk = p.partNumber.toUpperCase().replace(/[^A-Z0-9]/g, "");
      const dist = levenshtein(clean, pk);
      if (dist < bestDist) { bestDist = dist; bestMatch = p; }
    }
    if (bestMatch && bestDist <= 2) return bestMatch;
  }

  return null;
}

/* ── Levenshtein distance (simple) ── */
function levenshtein(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  // Quick exit for very different lengths
  if (Math.abs(a.length - b.length) > 3) return Math.abs(a.length - b.length);
  const matrix: number[][] = [];
  for (let i = 0; i <= a.length; i++) { matrix[i] = [i]; }
  for (let j = 0; j <= b.length; j++) { matrix[0][j] = j; }
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost);
    }
  }
  return matrix[a.length][b.length];
}

export function IncomingStock() {
  const data = useConvexData();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // Employee
  const [selectedEmployee, setSelectedEmployee] = useState("");
  const [empSearch, setEmpSearch] = useState("");
  const [showEmpDropdown, setShowEmpDropdown] = useState(false);

  // Entry mode
  const [entryMode, setEntryMode] = useState<EntryMode>("manual");

  // Manual entry
  const [partNumber, setPartNumber] = useState("");
  const [qty, setQty] = useState("");

  // Batch metadata (from OCR)
  const [poNumber, setPoNumber] = useState("");
  const [deliveryNumber, setDeliveryNumber] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");

  // Lines (from manual + CSV + OCR)
  const [lines, setLines] = useState<BatchLine[]>([]);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [ocrProgress, setOcrProgress] = useState<string | null>(null);
  const [ocrImages, setOcrImages] = useState<string[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);

  // Commit
  const [committing, setCommitting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [confirmRemoveIdx, setConfirmRemoveIdx] = useState<number | null>(null);

  const activeEmployees = data.employees.filter(e => e.active);
  const filteredEmployees = useMemo(() => {
    if (!empSearch) return activeEmployees;
    const q = empSearch.toLowerCase();
    return activeEmployees.filter(e =>
      e.name.toLowerCase().includes(q) ||
      e.initials.toLowerCase().includes(q) ||
      (e.email || "").toLowerCase().includes(q)
    );
  }, [activeEmployees, empSearch]);

  const matchedPart = data.parts.find(p => p.partNumber.toLowerCase() === partNumber.toLowerCase());
  const knownParts = useMemo(() => data.parts.map(p => ({ partNumber: p.partNumber, description: p.description })), [data.parts]);

  const addManualItem = () => {
    if (!matchedPart || !qty) return;
    setLines(prev => [...prev, {
      lineNo: prev.length + 1,
      partNumber_OCR: matchedPart.partNumber,
      partNumber_Final: matchedPart.partNumber,
      description: matchedPart.description,
      qty: parseInt(qty),
      matchStatus: "MATCHED",
      resolvedPartNumber: matchedPart.partNumber,
      isSelected: true,
      confidence: 100,
    }]);
    setPartNumber(""); setQty("");
  };

  /* ── Photo/Camera OCR via OpenAI gpt-4o Vision (direct) ── */
  const runOCR = async (file: File) => {
    setIsProcessing(true);
    setOcrProgress("📸 Preparing image for AI Vision...");
    const url = URL.createObjectURL(file);
    setOcrImages(prev => [...prev, url]);

    try {
      // Convert file to base64 using FileReader (safe for large files — no stack overflow)
      const dataUrl: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("Failed to read image"));
        reader.readAsDataURL(file);
      });

      setOcrProgress("🔍 Sending to OpenAI gpt-4o Vision...");

      // Build condensed part number list for the AI prompt
      const partList = knownParts.map(p => p.partNumber).join(", ");

      const OPENAI_KEY = import.meta.env.VITE_OPENAI_KEY || "";

      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${OPENAI_KEY}`,
        },
        body: JSON.stringify({
          model: "gpt-4o",
          max_tokens: 4096,
          messages: [
            {
              role: "system",
              content: `You are an expert OCR reader for QuidelOrtho VITROS 5600/7600 warehouse packing lists.

DOCUMENT FORMAT:
These are "CONTAINER PACKING LIST" or "ORDER PACKING LIST" documents from QuidelOrtho Sales Company LLC. They are frequently photographed SIDEWAYS (rotated 90°) — the text reads left-to-right when you tilt your head. Handle any rotation.

TABLE STRUCTURE (columns left to right):
LINE | PRODUCT CODE + DESCRIPTION + GTIN | LOT/EXPIRY | UNIT OF MEAS | QTY/UNIT | GROSS WEIGHT

CRITICAL RULES:
1. The PRODUCT CODE is the part number (first line of the cell). The DESCRIPTION is the second line. The GTIN line below is always empty — skip it.
2. Read the QTY/UNIT column for quantity (NOT Gross Weight, NOT Line number).
3. The same part number may appear on multiple lines with different quantities — list each line separately.
4. Extract the PURCHASE ORDER NO, DELIVERY #, and TRACKING # from the header area.
5. Multi-page documents: just extract what's on THIS page.

PART NUMBER FORMATS (QuidelOrtho):
- J##### (most common, e.g., J37203, J37360, J24687, J35342)
- J#####P (with P suffix, e.g., J70305P, J56801P, J71080P, J70803P)
- 1H#### (e.g., 1H5653, 1H1256, 1H5419, 1H5512)
- 1C#### (e.g., 1C5846)
- 142### (e.g., 142069)
- 354### (e.g., 354984)

KNOWN PART NUMBERS IN OUR INVENTORY (match extracted numbers against these — if close, use the known one):
${partList}

EXAMPLE EXTRACTION from a real document:
Document has LINE 1: "J37203 / Bearing, Rotor Pad / GTIN:" with QTY 32 → {"partNumber":"J37203","partNumber_raw":"J37203","description":"Bearing, Rotor Pad","qty":32}

Return ONLY valid JSON (no markdown, no code fences):
{
  "poNumber": "string or empty",
  "deliveryNumber": "string or empty",
  "trackingNumber": "string or empty",
  "lines": [
    {"partNumber": "corrected part number", "partNumber_raw": "exactly as printed on document", "description": "item description", "qty": number}
  ]
}

If you truly cannot read anything, return: {"poNumber":"","deliveryNumber":"","trackingNumber":"","lines":[]}`
            },
            {
              role: "user",
              content: [
                { type: "text", text: "Read this QuidelOrtho packing list and extract every line item with part number and quantity. The document may be rotated sideways." },
                { type: "image_url", image_url: { url: dataUrl, detail: "high" } }
              ]
            }
          ]
        }),
      });

      if (!response.ok) {
        const errBody = await response.text();
        throw new Error(`OpenAI API ${response.status}: ${errBody.slice(0, 200)}`);
      }

      const json = await response.json();
      const content = json.choices?.[0]?.message?.content || "";

      // Parse JSON from the response (strip markdown fences if any)
      let ocrData: any;
      try {
        const cleaned = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
        ocrData = JSON.parse(cleaned);
      } catch {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          ocrData = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error("Could not parse AI response");
        }
      }

      if (ocrData.poNumber && !poNumber) setPoNumber(ocrData.poNumber);
      if (ocrData.deliveryNumber && !deliveryNumber) setDeliveryNumber(ocrData.deliveryNumber);
      if (ocrData.trackingNumber && !trackingNumber) setTrackingNumber(ocrData.trackingNumber);

      if (ocrData.lines && ocrData.lines.length > 0) {
        const newLines: BatchLine[] = ocrData.lines.map((line: any, i: number) => {
          const aiPN = (line.partNumber || "").trim();
          const rawPN = (line.partNumber_raw || aiPN).trim();
          // Try AI-corrected number first, then raw, then smart match both
          const directMatch = knownParts.find(p => p.partNumber.toUpperCase() === aiPN.toUpperCase());
          const matched = directMatch || smartMatchPart(aiPN, knownParts) || smartMatchPart(rawPN, knownParts);
          return {
            lineNo: lines.length + i + 1,
            partNumber_OCR: rawPN || aiPN,
            partNumber_Final: matched ? matched.partNumber : aiPN,
            description: matched ? matched.description : (line.description || ""),
            qty: parseInt(line.qty) || 1,
            matchStatus: matched ? "MATCHED" as const : "UNMATCHED" as const,
            resolvedPartNumber: matched?.partNumber,
            isSelected: !!matched,
            confidence: matched ? (directMatch ? 99 : 90) : 60,
          };
        });

        setLines(prev => [...prev, ...newLines.map((l, i) => ({ ...l, lineNo: prev.length + i + 1 }))]);
        const matchedCount = newLines.filter(l => l.matchStatus === "MATCHED").length;
        setOcrProgress(`✅ AI Vision found ${newLines.length} items (${matchedCount} matched)`);
      } else {
        setOcrProgress("⚠ Could not read any line items. Try a clearer photo or enter manually.");
      }
    } catch (err: any) {
      console.error("OCR error:", err);
      setOcrProgress(`⚠ ${err?.message || "OCR failed"}. Try a clearer photo or enter manually.`);
    }
    setIsProcessing(false);
  };

  const handleCameraCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    runOCR(file);
  };

  /* ── CSV Upload ── */
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    // If it's an image, run OCR
    if (file.type.startsWith("image/")) {
      runOCR(file);
      return;
    }

    if (!file.name.match(/\.csv$/i)) {
      setUploadStatus("⚠️ Please upload a .csv or image file");
      return;
    }

    setUploadStatus("Parsing CSV file...");
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      const csvLines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      if (csvLines.length < 2) { setUploadStatus("CSV file is empty or has no data rows"); return; }

      const headers = parseCSVLine(csvLines[0]).map(h => h.toLowerCase());
      const partCol = headers.findIndex(h => /part\s*[#]?|part\s*num|partnum|product.*code|sku|item\s*#?|material|p\/?n/i.test(h));
      const descCol = headers.findIndex(h => /desc|name|item\s*desc|material\s*desc/i.test(h));
      const qtyCol = headers.findIndex(h => /qty|qoh|quantity|count|stock|on.?hand|amount|units/i.test(h));

      const effectivePartCol = partCol >= 0 ? partCol : 0;
      const effectiveDescCol = descCol >= 0 ? descCol : (headers.length > 1 ? 1 : -1);

      const parsed: BatchLine[] = [];
      for (let i = 1; i < csvLines.length; i++) {
        const cols = parseCSVLine(csvLines[i]);
        const pn = cols[effectivePartCol] || "";
        const desc = effectiveDescCol >= 0 ? (cols[effectiveDescCol] || "") : "";
        const qtyVal = qtyCol >= 0 ? (parseInt(cols[qtyCol]) || 1) : 1;
        if (!pn && !desc) continue;
        if (/^(total|sum|count|grand)/i.test(pn)) continue;

        const known = knownParts.find(k => k.partNumber.toUpperCase() === pn.toUpperCase());
        parsed.push({
          lineNo: parsed.length + 1,
          partNumber_OCR: pn,
          partNumber_Final: pn,
          description: known ? known.description : desc,
          qty: qtyVal,
          matchStatus: known ? "MATCHED" : "UNMATCHED",
          resolvedPartNumber: known?.partNumber,
          isSelected: !!known,
          confidence: known ? 95 : 70,
        });
      }

      if (parsed.length > 0) {
        setLines(prev => [...prev, ...parsed.map((l, i) => ({ ...l, lineNo: prev.length + i + 1 }))]);
        const matched = parsed.filter(l => l.matchStatus === "MATCHED").length;
        setUploadStatus(`✅ CSV: ${parsed.length} items imported (${matched} matched, ${parsed.length - matched} unmatched)`);
      } else {
        setUploadStatus("No items found in CSV. Check that the file has headers like Part #, Description, QOH.");
      }
    };
    reader.readAsText(file);
  };

  const removeLine = (idx: number) => {
    setLines(prev => prev.filter((_, i) => i !== idx).map((l, i) => ({ ...l, lineNo: i + 1 })));
  };

  const toggleSelect = (idx: number) => {
    setLines(prev => {
      const updated = [...prev];
      updated[idx] = { ...updated[idx], isSelected: !updated[idx].isSelected };
      return updated;
    });
  };

  const updateLineQty = (idx: number, raw: string) => {
    setLines(prev => {
      const updated = [...prev];
      // Allow empty string so user can clear the field, store as 0 internally
      const parsed = raw === "" ? 0 : parseInt(raw);
      updated[idx] = { ...updated[idx], qty: isNaN(parsed) ? 0 : parsed, _qtyRaw: raw } as any;
      return updated;
    });
  };

  // Inline editing for part numbers
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editPN, setEditPN] = useState("");

  const startEditLine = (idx: number) => {
    setEditingIdx(idx);
    setEditPN(lines[idx].partNumber_Final);
  };

  const saveEditLine = (idx: number) => {
    const pn = editPN.trim().toUpperCase();
    if (!pn) { setEditingIdx(null); return; }
    const matched = data.parts.find(p => p.partNumber.toUpperCase() === pn);
    setLines(prev => {
      const updated = [...prev];
      updated[idx] = {
        ...updated[idx],
        partNumber_Final: matched ? matched.partNumber : pn,
        description: matched ? matched.description : updated[idx].description,
        matchStatus: matched ? "MATCHED" : "UNMATCHED",
        resolvedPartNumber: matched?.partNumber,
        isSelected: !!matched,
        confidence: matched ? 99 : 60,
      };
      return updated;
    });
    setEditingIdx(null);
  };

  const addBlankLine = () => {
    setLines(prev => [...prev, {
      lineNo: prev.length + 1,
      partNumber_OCR: "",
      partNumber_Final: "",
      description: "",
      qty: 1,
      matchStatus: "UNMATCHED" as const,
      resolvedPartNumber: undefined,
      isSelected: false,
      confidence: 0,
    }]);
    // Auto-open edit on the new line
    setTimeout(() => setEditingIdx(lines.length), 50);
  };

  const selectedMatchedLines = lines.filter(l => l.isSelected && l.matchStatus === "MATCHED");

  const commitAll = async () => {
    if (!selectedEmployee) {
      setResult("⚠️ Please select an employee before committing");
      return;
    }
    if (selectedMatchedLines.length === 0) {
      setResult("⚠️ No matched items selected to receive");
      return;
    }
    setCommitting(true);
    try {
      let success = 0;
      for (const line of selectedMatchedLines) {
        await data.scanPart("RECEIVE", line.resolvedPartNumber || line.partNumber_Final, line.qty, selectedEmployee);
        success++;
      }
      setResult(`✅ ${success} item(s) received successfully by ${selectedEmployee}`);
      setLines([]);
      setUploadStatus(null);
      setOcrProgress(null);
      setOcrImages([]);
      setPoNumber("");
      setDeliveryNumber("");
      setTrackingNumber("");
    } catch (e) {
      setResult("❌ " + (e instanceof Error ? e.message : "Failed"));
    }
    setCommitting(false);
  };

  const isLocked = !selectedEmployee;

  const MATCH_BG: Record<string, { bg: string; text: string; label: string }> = {
    MATCHED: { bg: "#22c55e20", text: "#22c55e", label: "MATCHED" },
    UNMATCHED: { bg: "#ef444420", text: "#ef4444", label: "UNMATCHED" },
    PENDING: { bg: "#f59e0b20", text: "#f59e0b", label: "PENDING" },
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold" style={{ color: theme.textPrimary }}>📥 Incoming Stock Intake</h2>
        <p className="text-sm mt-0.5" style={{ color: theme.textSecondary }}>Log new stock as it arrives from the warehouse</p>
      </div>

      {/* Employee Selection — required */}
      <WebCard className={`p-4 ${!selectedEmployee ? "ring-2 ring-amber-400" : ""}`}>
        <div className="flex items-center gap-2 mb-2">
          <label className="text-[10px] font-bold uppercase" style={{ color: theme.textMuted }}>Receiving Employee *</label>
        </div>
        <div className="relative">
          <div
            className="flex items-center gap-2 px-3 py-2.5 rounded-xl border cursor-pointer"
            style={{ borderColor: showEmpDropdown ? "#6366f1" : theme.cardBorder, backgroundColor: "#111827" }}
            onClick={() => setShowEmpDropdown(!showEmpDropdown)}
          >
            <Search className="w-4 h-4 flex-shrink-0" style={{ color: theme.textMuted }} />
            <input
              className="flex-1 bg-transparent text-sm outline-none"
              style={{ color: theme.textPrimary }}
              placeholder="Type initials or name to search..."
              value={showEmpDropdown ? empSearch : selectedEmployee}
              onChange={e => { setEmpSearch(e.target.value); setShowEmpDropdown(true); }}
              onFocus={() => setShowEmpDropdown(true)}
            />
            {selectedEmployee && !showEmpDropdown ? (
              <button onClick={(e) => { e.stopPropagation(); setSelectedEmployee(""); setEmpSearch(""); }}>
                <X className="w-4 h-4" style={{ color: theme.textMuted }} />
              </button>
            ) : (
              <ChevronDown className="w-4 h-4 flex-shrink-0" style={{ color: theme.textMuted }} />
            )}
          </div>
          {showEmpDropdown && (
            <div className="absolute z-50 left-0 right-0 mt-1 max-h-60 overflow-y-auto rounded-xl border shadow-lg"
              style={{ borderColor: theme.cardBorder, backgroundColor: "#111827" }}>
              {filteredEmployees.length === 0 ? (
                <div className="px-4 py-3 text-sm text-center" style={{ color: theme.textMuted }}>No employees found</div>
              ) : (
                filteredEmployees.map(emp => (
                  <button key={emp._id}
                    onClick={() => { setSelectedEmployee(emp.name); setEmpSearch(""); setShowEmpDropdown(false); }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.05] transition-colors text-left border-b last:border-0"
                    style={{ borderColor: theme.cardBorder }}>
                    <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0" style={{ backgroundColor: "#6366f1" }}>
                      {emp.initials}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium" style={{ color: theme.textPrimary }}>{emp.name}</div>
                      {emp.email && <div className="text-[10px] truncate" style={{ color: theme.textMuted }}>{emp.email}</div>}
                    </div>
                    {selectedEmployee === emp.name && <span className="text-xs font-bold" style={{ color: "#6366f1" }}>✓</span>}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
        {!selectedEmployee && (
          <p className="flex items-center gap-1 text-[10px] font-bold mt-2" style={{ color: "#f59e0b" }}>
            <AlertTriangle className="w-3 h-3" /> Select an employee before adding items
          </p>
        )}
      </WebCard>

      {/* Entry Mode Selector */}
      <div style={isLocked ? { opacity: 0.5, pointerEvents: "none" } : undefined}>
        <div className="grid grid-cols-3 gap-2">
          {([
            { mode: "photo" as const, icon: <Camera className="w-6 h-6" />, label: "Photo", sub: "Snap packing list" },
            { mode: "upload" as const, icon: <Upload className="w-6 h-6" />, label: "Upload File", sub: "Image / CSV" },
            { mode: "manual" as const, icon: <Keyboard className="w-6 h-6" />, label: "Manual", sub: "Type part #" },
          ]).map(({ mode, icon, label, sub }) => (
            <button key={mode} onClick={() => {
              setEntryMode(mode);
              if (mode === "photo") setTimeout(() => cameraInputRef.current?.click(), 100);
              if (mode === "upload") setTimeout(() => fileInputRef.current?.click(), 100);
            }}
              className="flex flex-col items-center gap-1.5 py-4 px-3 rounded-xl border-2 transition-all"
              style={{
                borderColor: entryMode === mode ? "#6366f1" : theme.cardBorder,
                backgroundColor: entryMode === mode ? "#6366f115" : theme.cardBg,
              }}>
              <div style={{ color: entryMode === mode ? "#6366f1" : theme.textSecondary }}>{icon}</div>
              <span className="text-xs font-bold" style={{ color: theme.textPrimary }}>{label}</span>
              <span className="text-[10px]" style={{ color: theme.textMuted }}>{sub}</span>
            </button>
          ))}
        </div>

        {/* Hidden file inputs */}
        <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleCameraCapture} />
        <input ref={fileInputRef} type="file" accept="image/*,.csv,.xlsx,.xls" className="hidden" onChange={handleFileUpload} />
      </div>

      {/* OCR Processing indicator */}
      {isProcessing && (
        <WebCard className="p-4">
          <div className="flex items-center gap-3">
            <Loader2 className="w-5 h-5 animate-spin" style={{ color: "#6366f1" }} />
            <span className="text-sm font-medium" style={{ color: theme.textPrimary }}>{ocrProgress}</span>
          </div>
        </WebCard>
      )}

      {/* OCR/Upload status */}
      {(ocrProgress && !isProcessing) && (
        <div className="px-3 py-2 rounded-lg text-xs" style={{
          backgroundColor: ocrProgress.startsWith("✅") ? "#22c55e15" : ocrProgress.startsWith("⚠") ? "#f59e0b15" : "#6366f115",
          color: ocrProgress.startsWith("✅") ? "#22c55e" : ocrProgress.startsWith("⚠") ? "#f59e0b" : "#6366f1"
        }}>
          {ocrProgress}
        </div>
      )}
      {uploadStatus && (
        <div className="px-3 py-2 rounded-lg text-xs" style={{
          backgroundColor: uploadStatus.startsWith("✅") ? "#22c55e15" : "#f59e0b15",
          color: uploadStatus.startsWith("✅") ? "#22c55e" : "#f59e0b"
        }}>
          {uploadStatus}
        </div>
      )}

      {/* OCR Image thumbnails */}
      {ocrImages.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {ocrImages.map((url, i) => (
            <div key={i} className="relative w-16 h-16 rounded-lg overflow-hidden border" style={{ borderColor: theme.cardBorder }}>
              <img src={url} alt={`Scan ${i + 1}`} className="w-full h-full object-cover" />
              <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-[8px] text-center text-white font-bold py-0.5">
                Photo {i + 1}
              </div>
            </div>
          ))}
          <button onClick={() => cameraInputRef.current?.click()}
            className="w-16 h-16 rounded-lg border-2 border-dashed flex flex-col items-center justify-center gap-0.5"
            style={{ borderColor: theme.cardBorder, color: theme.textMuted }}>
            <Plus className="w-4 h-4" />
            <span className="text-[8px]">More</span>
          </button>
        </div>
      )}

      {/* Batch Metadata (from OCR or manual) */}
      {(poNumber || deliveryNumber || trackingNumber || lines.length > 0) && (
        <div style={isLocked ? { opacity: 0.5, pointerEvents: "none" } : undefined}>
          <WebCard className="p-4 space-y-2">
            <h3 className="text-[10px] font-bold uppercase" style={{ color: theme.textMuted }}>Shipment Details</h3>
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: "PO #", value: poNumber, set: setPoNumber },
                { label: "Delivery #", value: deliveryNumber, set: setDeliveryNumber },
                { label: "Tracking #", value: trackingNumber, set: setTrackingNumber },
              ].map(({ label, value, set }) => (
                <div key={label}>
                  <label className="text-[9px] font-semibold" style={{ color: theme.textMuted }}>{label}</label>
                  <input className="w-full mt-0.5 px-2 py-1.5 rounded-lg text-xs border outline-none"
                    style={{ borderColor: theme.cardBorder, backgroundColor: "#111827", color: theme.textPrimary }}
                    value={value} onChange={e => set(e.target.value)} placeholder={label} />
                </div>
              ))}
            </div>
          </WebCard>
        </div>
      )}

      {/* Manual Entry (shown when manual mode or always available) */}
      {entryMode === "manual" && (
        <div style={isLocked ? { opacity: 0.5, pointerEvents: "none" } : undefined}>
          <WebCard className="p-4 space-y-3">
            <h3 className="text-sm font-bold" style={{ color: theme.textPrimary }}>✏️ Manual Entry</h3>
            <div>
              <label className="text-[10px] font-semibold" style={{ color: theme.textSecondary }}>Part Number</label>
              <div className="flex items-center gap-2 mt-1 px-3 py-2 rounded-xl border" style={{ borderColor: theme.cardBorder, backgroundColor: "#111827" }}>
                <Search className="w-4 h-4 text-slate-500" />
                <input className="flex-1 bg-transparent text-sm outline-none" style={{ color: theme.textPrimary }}
                  placeholder="Scan or type part number..." value={partNumber} onChange={e => setPartNumber(e.target.value)} />
              </div>
            </div>
            {partNumber && !matchedPart && (
              <div className="px-3 py-2 rounded-lg text-xs" style={{ backgroundColor: "#ef444415", color: "#ef4444" }}>
                ✗ No matching part found
              </div>
            )}
            {matchedPart && (
              <div className="px-3 py-2 rounded-lg text-xs" style={{ backgroundColor: theme.statusOk + "15", color: theme.statusOk }}>
                ✓ {matchedPart.description} (Current QOH: {matchedPart.qoh})
              </div>
            )}
            <div>
              <label className="text-[10px] font-semibold" style={{ color: theme.textSecondary }}>Quantity</label>
              <input type="number" className="w-full mt-1 px-3 py-2 rounded-xl text-sm outline-none border"
                style={{ borderColor: theme.cardBorder, backgroundColor: "#111827", color: theme.textPrimary }}
                placeholder="Enter quantity" value={qty} onChange={e => setQty(e.target.value)} />
            </div>
            <button onClick={addManualItem} disabled={!matchedPart || !qty}
              className="w-full py-2.5 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 disabled:opacity-40"
              style={{ backgroundColor: "#6366f1" }}>
              <Plus className="w-4 h-4" /> Add to Receiving List
            </button>
          </WebCard>
        </div>
      )}

      {/* Receiving List / Review Table */}
      <WebCard className="overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: theme.cardBorder }}>
          <h3 className="text-sm font-bold" style={{ color: theme.textPrimary }}>📋 Receiving List</h3>
          <div className="flex items-center gap-3">
            {lines.length > 0 && (
              <span className="text-[10px] font-medium" style={{ color: theme.textMuted }}>
                {selectedMatchedLines.length} of {lines.length} ready
              </span>
            )}
            <button onClick={addBlankLine}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold border hover:bg-white/5 transition-colors"
              style={{ borderColor: theme.cardBorder, color: "#6366f1" }}>
              <Plus className="w-3 h-3" /> Add Item
            </button>
          </div>
        </div>
        {lines.length === 0 ? (
          <div className="py-8 text-center">
            <div className="text-3xl opacity-30 mb-2">📦</div>
            <div className="text-sm" style={{ color: theme.textSecondary }}>No items added yet</div>
            <div className="text-[10px] mt-1" style={{ color: theme.textMuted }}>
              Snap a photo of the packing list, upload a CSV, or enter manually
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
                    <th className="px-3 py-2 text-right" style={{ color: theme.textSecondary }}>Qty</th>
                    <th className="px-3 py-2 text-center" style={{ color: theme.textSecondary }}>Status</th>
                    <th className="px-3 py-2 text-right w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, i) => {
                    const m = MATCH_BG[line.matchStatus];
                    return (
                      <tr key={i} className="border-b transition-colors"
                        style={{
                          borderColor: theme.cardBorder,
                          backgroundColor: line.isSelected ? "rgba(99,102,241,0.05)" : "transparent",
                          opacity: !line.isSelected ? 0.5 : 1,
                        }}>
                        <td className="px-3 py-2">
                          <button onClick={() => toggleSelect(i)}
                            className="w-5 h-5 rounded border flex items-center justify-center"
                            style={{
                              borderColor: line.isSelected ? "#6366f1" : theme.cardBorder,
                              backgroundColor: line.isSelected ? "#6366f1" : "transparent"
                            }}>
                            {line.isSelected && <Check className="w-3 h-3 text-white" />}
                          </button>
                        </td>
                        <td className="px-3 py-2" style={{ color: theme.textMuted }}>{line.lineNo}</td>
                        <td className="px-3 py-2">
                          {editingIdx === i ? (
                            <div className="flex items-center gap-1">
                              <input
                                autoFocus
                                className="w-24 px-2 py-1 rounded border text-xs font-mono font-bold uppercase"
                                style={{ borderColor: "#6366f1", backgroundColor: "#111827", color: theme.textPrimary, outline: "none" }}
                                value={editPN}
                                onChange={e => setEditPN(e.target.value)}
                                onKeyDown={e => { if (e.key === "Enter") saveEditLine(i); if (e.key === "Escape") setEditingIdx(null); }}
                                placeholder="Part #"
                              />
                              <button onClick={() => saveEditLine(i)} className="p-1 rounded hover:bg-white/10" title="Save">
                                <Check className="w-3.5 h-3.5" style={{ color: theme.statusOk }} />
                              </button>
                              <button onClick={() => setEditingIdx(null)} className="p-1 rounded hover:bg-white/10" title="Cancel">
                                <X className="w-3.5 h-3.5" style={{ color: theme.textMuted }} />
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5 group">
                              <span className="font-mono font-bold" style={{ color: theme.textPrimary }}>
                                {line.partNumber_Final || <span style={{ color: theme.textMuted }}>—</span>}
                              </span>
                              <button onClick={() => startEditLine(i)}
                                className="p-0.5 rounded opacity-40 hover:opacity-100 transition-opacity"
                                title="Edit part number">
                                <Pencil className="w-3 h-3" style={{ color: "#6366f1" }} />
                              </button>
                              {line.partNumber_OCR && line.partNumber_OCR !== line.partNumber_Final && (
                                <div className="text-[9px]" style={{ color: theme.textMuted }}>OCR: {line.partNumber_OCR}</div>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2" style={{ color: theme.textSecondary }}>
                          <span className="truncate block max-w-[200px]">{line.description}</span>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <input type="number" className="w-16 px-2 py-1 rounded border text-right text-xs font-bold"
                            style={{ borderColor: theme.cardBorder, backgroundColor: "#111827", color: theme.textPrimary }}
                            value={(line as any)._qtyRaw ?? line.qty} onChange={e => updateLineQty(i, e.target.value)} min={0} />
                        </td>
                        <td className="px-3 py-2 text-center">
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold" style={{ backgroundColor: m.bg, color: m.text }}>
                            {m.label}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button onClick={() => setConfirmRemoveIdx(i)} className="p-1 rounded hover:bg-white/5">
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
                <span>{lines.filter(l => l.matchStatus === "MATCHED").length} matched · {lines.filter(l => l.matchStatus === "UNMATCHED").length} unmatched</span>
                <span className="font-bold" style={{ color: theme.statusOk }}>
                  Total: +{selectedMatchedLines.reduce((s, l) => s + l.qty, 0)} units
                </span>
              </div>
              {lines.some(l => l.matchStatus === "UNMATCHED") && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-[10px]" style={{ backgroundColor: "#f59e0b15", color: "#f59e0b" }}>
                  <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                  Unmatched items won't be received. Edit the part number or remove them.
                </div>
              )}
              <div className="flex gap-2">
                <button onClick={() => { setLines([]); setUploadStatus(null); setOcrProgress(null); setOcrImages([]); }}
                  className="flex-1 py-2.5 rounded-xl text-sm font-bold border"
                  style={{ borderColor: theme.cardBorder, color: theme.textSecondary }}>
                  Clear All
                </button>
                <button onClick={commitAll} disabled={committing || isLocked || selectedMatchedLines.length === 0}
                  className="flex-[2] py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-40 flex items-center justify-center gap-2"
                  style={{ backgroundColor: theme.statusOk }}>
                  {committing ? "Processing..." : `Receive ${selectedMatchedLines.length} Matched Items`}
                </button>
              </div>
            </div>
          </>
        )}
      </WebCard>

      {result && (
        <div className="px-4 py-3 rounded-xl text-sm" style={{
          backgroundColor: result.startsWith("✅") ? theme.statusOk + "15" : result.startsWith("⚠") ? "#f59e0b15" : theme.statusOut + "15",
          color: result.startsWith("✅") ? theme.statusOk : result.startsWith("⚠") ? "#f59e0b" : theme.statusOut
        }}>
          {result}
        </div>
      )}

      {/* Delete Confirmation */}
      {confirmRemoveIdx !== null && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => setConfirmRemoveIdx(null)}>
          <div className="w-full max-w-sm mx-4 rounded-2xl border shadow-2xl" style={{ backgroundColor: "#111827", borderColor: theme.cardBorder }}
            onClick={e => e.stopPropagation()}>
            <div className="p-6 text-center space-y-3">
              <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto" style={{ backgroundColor: "#ef444420" }}>
                <AlertTriangle className="w-6 h-6" style={{ color: "#ef4444" }} />
              </div>
              <h3 className="text-lg font-bold" style={{ color: theme.textPrimary }}>Are you sure?</h3>
              <p className="text-sm" style={{ color: theme.textSecondary }}>
                Remove <strong style={{ color: theme.textPrimary }}>{lines[confirmRemoveIdx]?.partNumber_Final}</strong> from the receiving list?
              </p>
            </div>
            <div className="flex gap-2 p-4 border-t" style={{ borderColor: theme.cardBorder }}>
              <button onClick={() => setConfirmRemoveIdx(null)} className="flex-1 py-2.5 rounded-xl text-sm font-bold border"
                style={{ borderColor: theme.cardBorder, color: theme.textSecondary }}>Cancel</button>
              <button onClick={() => { removeLine(confirmRemoveIdx); setConfirmRemoveIdx(null); }}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white"
                style={{ backgroundColor: "#ef4444" }}>Remove</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
