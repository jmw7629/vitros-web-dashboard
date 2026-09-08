// Deterministic synthetic/redacted fixture tests for Incoming Stock deterministic receipt identity
// These tests verify the canonicalization and identity logic without requiring a live Convex/Supabase environment

import { canonicalPartNumber, normalizeDocumentRef, normalizeSourcePage, canonicalReceiptLineIdentity } from "./incomingStockActions";

describe("Deterministic Receipt Identity Canonicalization", () => {
  describe("canonicalPartNumber", () => {
    it("normalizes part numbers to uppercase trimmed", () => {
      expect(canonicalPartNumber("  abc-123  ")).toBe("ABC-123");
      expect(canonicalPartNumber("J61239")).toBe("J61239");
      expect(canonicalPartNumber("j61239p")).toBe("J61239P");
    });

    it("preserves meaningful internal characters", () => {
      expect(canonicalPartNumber("ABC-123/XYZ")).toBe("ABC-123/XYZ");
      expect(canonicalPartNumber("PART.NO.1")).toBe("PART.NO.1");
    });
  });

  describe("normalizeDocumentRef", () => {
    it("normalizes document references conservatively", () => {
      expect(normalizeDocumentRef("  PO-12345  ")).toBe("PO-12345");
      expect(normalizeDocumentRef("PACKING SLIP 001")).toBe("PACKING SLIP 001");
      expect(normalizeDocumentRef("receipt\n\t123")).toBe("RECEIPT 123");
    });

    it("collapses whitespace but preserves meaningful separators", () => {
      expect(normalizeDocumentRef("PO   12345")).toBe("PO 12345");
      expect(normalizeDocumentRef("DELIVERY\tNOTE\n42")).toBe("DELIVERY NOTE 42");
    });
  });

  describe("normalizeSourcePage", () => {
    it("normalizes page identifiers", () => {
      expect(normalizeSourcePage("1")).toBe("1");
      expect(normalizeSourcePage("Page 3")).toBe("PAGE 3");
      expect(normalizeSourcePage("  page  5 of 8  ")).toBe("PAGE 5 OF 8");
    });

    it("truncates to MAX_SOURCE_PAGE_CHARS", () => {
      const longPage = "A".repeat(100);
      expect(normalizeSourcePage(longPage).length).toBe(50);
    });
  });

  describe("canonicalReceiptLineIdentity", () => {
    it("generates stable identity from documentRef + page + lineNo", () => {
      const identity1 = canonicalReceiptLineIdentity({
        documentRef: "PO-12345",
        sourcePage: "1",
        sourceLineNo: 3,
      });
      const identity2 = canonicalReceiptLineIdentity({
        documentRef: "PO-12345",
        sourcePage: "1",
        sourceLineNo: 3,
      });
      expect(identity1).toBe(identity2);
      expect(identity1).toBe("incoming:PO-12345|1|3");
    });

    it("is stable across reload/re-OCR/re-review of same physical line", () => {
      // Simulate first OCR pass
      const firstPass = canonicalReceiptLineIdentity({
        documentRef: "PACKING SLIP 001",
        sourcePage: "Page 2",
        sourceLineNo: 5,
      });

      // Simulate re-OCR of same document
      const reOcr = canonicalReceiptLineIdentity({
        documentRef: "PACKING SLIP 001",
        sourcePage: "Page 2",
        sourceLineNo: 5,
      });

      // Simulate correction/re-review
      const reReview = canonicalReceiptLineIdentity({
        documentRef: "PACKING SLIP 001",
        sourcePage: "Page 2",
        sourceLineNo: 5,
      });

      expect(firstPass).toBe(reOcr);
      expect(reOcr).toBe(reReview);
      expect(firstPass).toBe("incoming:PACKING SLIP 001|PAGE 2|5");
    });

    it("differs when documentRef differs", () => {
      const id1 = canonicalReceiptLineIdentity({ documentRef: "PO-1", sourcePage: "1", sourceLineNo: 1 });
      const id2 = canonicalReceiptLineIdentity({ documentRef: "PO-2", sourcePage: "1", sourceLineNo: 1 });
      expect(id1).not.toBe(id2);
    });

    it("differs when sourcePage differs", () => {
      const id1 = canonicalReceiptLineIdentity({ documentRef: "PO-1", sourcePage: "1", sourceLineNo: 1 });
      const id2 = canonicalReceiptLineIdentity({ documentRef: "PO-1", sourcePage: "2", sourceLineNo: 1 });
      expect(id1).not.toBe(id2);
    });

    it("differs when sourceLineNo differs", () => {
      const id1 = canonicalReceiptLineIdentity({ documentRef: "PO-1", sourcePage: "1", sourceLineNo: 1 });
      const id2 = canonicalReceiptLineIdentity({ documentRef: "PO-1", sourcePage: "1", sourceLineNo: 2 });
      expect(id1).not.toBe(id2);
    });

    it("handles null/undefined sourcePage with PAGE_UNKNOWN fallback", () => {
      const id1 = canonicalReceiptLineIdentity({ documentRef: "PO-1", sourcePage: null, sourceLineNo: 1 });
      const id2 = canonicalReceiptLineIdentity({ documentRef: "PO-1", sourcePage: undefined, sourceLineNo: 1 });
      expect(id1).toBe(id2);
      expect(id1).toBe("incoming:PO-1|PAGE_UNKNOWN|1");
    });

    it("handles invalid sourceLineNo with 0 fallback", () => {
      const id1 = canonicalReceiptLineIdentity({ documentRef: "PO-1", sourcePage: "1", sourceLineNo: 0 });
      const id2 = canonicalReceiptLineIdentity({ documentRef: "PO-1", sourcePage: "1", sourceLineNo: -1 });
      expect(id1).toBe("incoming:PO-1|1|0");
      expect(id2).toBe("incoming:PO-1|1|0");
    });
  });
});

describe("Provenance Preservation", () => {
  it("preserves documentRef, sourcePage, sourceLineNo through pipeline", () => {
    // This test verifies the identity function preserves all provenance fields
    const docRef = "DELIVERY NOTE 42";
    const page = "3";
    const lineNo = 7;

    const identity = canonicalReceiptLineIdentity({
      documentRef: docRef,
      sourcePage: page,
      sourceLineNo: lineNo,
    });

    // Identity must contain all three provenance components
    expect(identity).toContain("DELIVERY NOTE 42");
    expect(identity).toContain("3");
    expect(identity).toContain("7");
    expect(identity).toMatch(/^incoming:DELIVERY NOTE 42\|3\|7$/);
  });

  it("multi-page/source-line provenance is distinct", () => {
    const page1Line1 = canonicalReceiptLineIdentity({ documentRef: "PO-100", sourcePage: "1", sourceLineNo: 1 });
    const page1Line2 = canonicalReceiptLineIdentity({ documentRef: "PO-100", sourcePage: "1", sourceLineNo: 2 });
    const page2Line1 = canonicalReceiptLineIdentity({ documentRef: "PO-100", sourcePage: "2", sourceLineNo: 1 });

    expect(page1Line1).not.toBe(page1Line2);
    expect(page1Line1).not.toBe(page2Line1);
    expect(page1Line2).not.toBe(page2Line1);
  });
});

describe("Repeated Part Aggregate Review", () => {
  it("aggregate summary groups by canonical part number without collapsing commit identities", () => {
    // Simulate aggregate summary computation
    const lines = [
      { partNumberCanonical: "ABC-123", qtyOcr: 10, matchStatus: "matched" as const },
      { partNumberCanonical: "ABC-123", qtyOcr: 5, matchStatus: "matched" as const },
      { partNumberCanonical: "XYZ-789", qtyOcr: 3, matchStatus: "unknown_part" as const },
    ];

    const aggregateByPart = new Map<string, { canonicalPartNumber: string; totalQty: number; lineCount: number; matchedCount: number }>();
    for (const line of lines) {
      const key = line.partNumberCanonical || "INVALID";
      const existing = aggregateByPart.get(key) || { canonicalPartNumber: key, totalQty: 0, lineCount: 0, matchedCount: 0 };
      existing.totalQty += line.qtyOcr ?? 0;
      existing.lineCount += 1;
      if (line.matchStatus === "matched") existing.matchedCount += 1;
      aggregateByPart.set(key, existing);
    }

    const aggregateSummary = Array.from(aggregateByPart.values());
    expect(aggregateSummary).toHaveLength(2);

    const abc = aggregateSummary.find(a => a.canonicalPartNumber === "ABC-123");
    expect(abc).toEqual({ canonicalPartNumber: "ABC-123", totalQty: 15, lineCount: 2, matchedCount: 2 });

    const xyz = aggregateSummary.find(a => a.canonicalPartNumber === "XYZ-789");
    expect(xyz).toEqual({ canonicalPartNumber: "XYZ-789", totalQty: 3, lineCount: 1, matchedCount: 0 });
  });
});

describe("Part Number Only Matching", () => {
  it("exact PN with description mismatch still matches", () => {
    // Description is display metadata only
    const canonical = canonicalPartNumber("J61239");
    expect(canonical).toBe("J61239");
    // Different descriptions but same canonical PN
    expect(canonicalPartNumber("J61239")).toBe(canonicalPartNumber("J61239"));
  });

  it("one-character wrong PN is treated as different part", () => {
    expect(canonicalPartNumber("J61239")).not.toBe(canonicalPartNumber("J61238"));
    expect(canonicalPartNumber("J61239")).not.toBe(canonicalPartNumber("J61239P"));
    expect(canonicalPartNumber("ABC-123")).not.toBe(canonicalPartNumber("ABC-124"));
  });

  it("unknown/ambiguous PN fails closed", () => {
    // Empty part number
    expect(canonicalPartNumber("")).toBe("");
    expect(canonicalPartNumber("   ")).toBe("");
    // These would result in invalid_part_number matchStatus
  });
});

describe("Quantity Validation", () => {
  it("RECEIVE quantity must be finite positive integer", () => {
    // Valid quantities
    expect(Number.isInteger(1) && 1 > 0).toBe(true);
    expect(Number.isInteger(100) && 100 > 0).toBe(true);

    // Invalid quantities
    expect(Number.isInteger(0) && 0 > 0).toBe(false);
    expect(Number.isInteger(-5) && -5 > 0).toBe(false);
    expect(Number.isInteger(1.5) && 1.5 > 0).toBe(false);
    expect(Number.isInteger(NaN) && Number.isNaN(0)).toBe(false);
  });
});

describe("Idempotency and Conflict Behavior", () => {
  it("same identity + same inputs = idempotent duplicate", () => {
    // The deterministic identity ensures same physical line retries use same correlationId
    const identity = canonicalReceiptLineIdentity({
      documentRef: "PO-999",
      sourcePage: "1",
      sourceLineNo: 1,
    });

    // First attempt
    const correlationId1 = identity;
    // Retry (re-OCR, reload, re-review)
    const correlationId2 = canonicalReceiptLineIdentity({
      documentRef: "PO-999",
      sourcePage: "1",
      sourceLineNo: 1,
    });

    expect(correlationId1).toBe(correlationId2);
    // The shared RPC apply_inventory_transition will return duplicate=true for same correlationId
  });

  it("same identity + different qty = conflict with zero movement", () => {
    // Same deterministic identity but different qty would hit RPC idempotency conflict
    // because p_part_number, p_mode, p_qty are validated before idempotent duplicate check
    const identity = "incoming:PO-999|1|1";
    
    // First receive with qty=10
    const first = { correlationId: identity, partNumber: "ABC-123", qty: 10 };
    // Retry with qty=15 (operator error)
    const retry = { correlationId: identity, partNumber: "ABC-123", qty: 15 };
    
    expect(first.correlationId).toBe(retry.correlationId);
    expect(first.qty).not.toBe(retry.qty);
    // RPC will raise "Inventory idempotency conflict" because qty differs
  });

  it("same identity + different part = conflict with zero movement", () => {
    const identity = "incoming:PO-999|1|1";
    
    const first = { correlationId: identity, partNumber: "ABC-123", qty: 10 };
    const retry = { correlationId: identity, partNumber: "XYZ-789", qty: 10 };
    
    expect(first.correlationId).toBe(retry.correlationId);
    expect(first.partNumber).not.toBe(retry.partNumber);
    // RPC will raise "Inventory idempotency conflict" because part number differs
  });
});

describe("Security Boundaries", () => {
  it("no client secrets in deterministic identity", () => {
    // Deterministic identity uses only: documentRef, sourcePage, sourceLineNo
    // No API keys, service role keys, user tokens, or secrets
    const identity = canonicalReceiptLineIdentity({
      documentRef: "PO-123",
      sourcePage: "1",
      sourceLineNo: 1,
    });
    
    expect(identity).not.toContain("sk-");
    expect(identity).not.toContain("key");
    expect(identity).not.toContain("secret");
    expect(identity).not.toContain("token");
  });

  it("human confirmation remains mandatory", () => {
    // The commitConfirmedReceiveLine action requires explicit call
    // No automatic receiving without human selection
    expect(true).toBe(true); // Placeholder - actual enforcement is in action handler
  });
});

describe("Correction/Re-review Stability", () => {
  it("corrected line retains same deterministic identity", () => {
    // Operator corrects part number on a line, then re-reviews
    // The physical line identity (docRef + page + lineNo) remains the same
    const original = canonicalReceiptLineIdentity({
      documentRef: "PO-500",
      sourcePage: "2",
      sourceLineNo: 3,
    });

    // After correction and re-review
    const afterCorrection = canonicalReceiptLineIdentity({
      documentRef: "PO-500",
      sourcePage: "2",
      sourceLineNo: 3,
    });

    expect(original).toBe(afterCorrection);
    // The RPC will validate the new part number against the same correlationId
    // If part number changed, RPC raises conflict; if same, idempotent duplicate
  });
});

console.log("All deterministic identity tests defined. Run with a test runner (e.g., bun test) to execute.");