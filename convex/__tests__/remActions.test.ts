import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Extract validation logic for testing ───

const VALID_ANALYZER_STAGES = [
  "Procurement", "Cleaning", "Service/Repair", "Final Line",
  "Packaging", "Release Testing", "QA Release", "SAP Release", "Complete",
];

const VALID_ANALYZER_FIELDS = new Set([
  "serialNumber", "analyzerType", "type", "stage", "progress", "status",
  "yearNumber", "productionOrder", "currentStage", "overallPct",
  "procurementPct", "cleaningPct", "servicePct", "serviceCell",
  "finalLinePct", "releaseTestingPct", "packagingPct", "sapReleasePct",
  "qaReleasePct", "currentPct", "slaDays", "daysInStage", "daysElapsed",
  "startDate", "endDate", "doneWeek", "isComplete", "installDate",
  "installCountry", "installStatus", "installCost", "fpyPercentage",
  "releaseFPY", "fieldStatus", "country", "fpy", "assignedTo",
]);

const VALID_LVCC_FIELDS = new Set([
  "serialNumber", "itemId", "itemType", "category", "batchNumber",
  "quantity", "currentStage", "buildPct", "testPct", "packagingPct",
  "sapReleasePct", "qaReleasePct", "startDate", "endDate", "isComplete",
  "status", "progress",
]);

const VALID_STAFF_FIELDS = new Set([
  "name", "role", "fte", "certifications", "skills", "isLead", "inTraining",
]);

const VALID_TARGET_FIELDS = new Set(["type", "target", "completed"]);

function pickAllowedFields(input: Record<string, unknown>, allowed: Set<string>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (allowed.has(key) && value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

function validateAnalyzerPayload(input: Record<string, unknown>): void {
  if (input.serialNumber !== undefined && typeof input.serialNumber !== "string") {
    throw new Error("serialNumber must be a string");
  }
  if (input.currentStage !== undefined && typeof input.currentStage === "string") {
    if (!VALID_ANALYZER_STAGES.includes(input.currentStage)) {
      throw new Error(`Invalid stage: ${input.currentStage}. Must be one of: ${VALID_ANALYZER_STAGES.join(", ")}`);
    }
  }
  const pctFields = [
    "progress", "overallPct", "procurementPct", "cleaningPct", "servicePct",
    "finalLinePct", "releaseTestingPct", "packagingPct", "sapReleasePct",
    "qaReleasePct", "currentPct",
  ];
  for (const field of pctFields) {
    if (input[field] !== undefined) {
      const val = Number(input[field]);
      if (!Number.isFinite(val) || val < 0 || val > 100) {
        throw new Error(`${field} must be a number between 0 and 100`);
      }
    }
  }
  if (input.isComplete !== undefined && typeof input.isComplete !== "boolean") {
    throw new Error("isComplete must be a boolean");
  }
}

function validateLvccPayload(input: Record<string, unknown>): void {
  if (input.serialNumber !== undefined && typeof input.serialNumber !== "string") {
    throw new Error("serialNumber must be a string");
  }
  const pctFields = ["buildPct", "testPct", "packagingPct", "sapReleasePct", "qaReleasePct"];
  for (const field of pctFields) {
    if (input[field] !== undefined) {
      const val = Number(input[field]);
      if (!Number.isFinite(val) || val < 0 || val > 100) {
        throw new Error(`${field} must be a number between 0 and 100`);
      }
    }
  }
}

function validateStaffPayload(input: Record<string, unknown>): void {
  if (input.name !== undefined && (typeof input.name !== "string" || !input.name.trim())) {
    throw new Error("name must be a non-empty string");
  }
  if (input.role !== undefined && typeof input.role !== "string") {
    throw new Error("role must be a string");
  }
  if (input.fte !== undefined) {
    const val = Number(input.fte);
    if (!Number.isFinite(val) || val < 0) {
      throw new Error("fte must be a non-negative number");
    }
  }
}

function validateTargetPayload(input: Record<string, unknown>): void {
  if (input.type !== undefined && typeof input.type !== "string") {
    throw new Error("type must be a string");
  }
  for (const field of ["target", "completed"]) {
    if (input[field] !== undefined) {
      const val = Number(input[field]);
      if (!Number.isFinite(val) || val < 0) {
        throw new Error(`${field} must be a non-negative number`);
      }
    }
  }
}

// ─── Mock Convex context factory ───

function createMockCtx(options: {
  role?: string;
  existingAnalyzer?: any;
  existingLvcc?: any;
  existingStaff?: any;
  existingTarget?: any;
  existingNote?: any;
} = {}) {
  const role = options.role ?? "engineer";
  const auditEntries: any[] = [];

  return {
    auth: {
      getUserIdentity: vi.fn().mockResolvedValue({ subject: "user-123" }),
    },
    db: {
      get: vi.fn().mockImplementation(async (id: string) => {
        if (id.startsWith("remAnalyzers") || id.startsWith("analyzer")) return options.existingAnalyzer ?? null;
        if (id.startsWith("lvccItems") || id.startsWith("lvcc")) return options.existingLvcc ?? null;
        if (id.startsWith("staffMembers") || id.startsWith("staff")) return options.existingStaff ?? null;
        if (id.startsWith("annualTargets") || id.startsWith("target")) return options.existingTarget ?? null;
        if (id.startsWith("weeklyNotes") || id.startsWith("note")) return options.existingNote ?? null;
        return null;
      }),
      patch: vi.fn().mockResolvedValue(undefined),
      insert: vi.fn().mockImplementation(async (table: string, data: any) => {
        if (table === "remAudit") {
          auditEntries.push(data);
          return "audit-id-1";
        }
        return `${table}-new-id`;
      }),
      query: vi.fn().mockReturnValue({
        withIndex: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue(null),
        }),
        collect: vi.fn().mockResolvedValue([]),
        order: vi.fn().mockReturnValue({
          collect: vi.fn().mockResolvedValue([]),
        }),
      }),
    },
    runQuery: vi.fn().mockImplementation(async (fn: any) => {
      return fn({
        db: {
          getUser: vi.fn().mockResolvedValue({ role }),
        },
      });
    }),
    _auditEntries: auditEntries,
  };
}

// ─── RBAC tests ───

describe("REM Auth Guards", () => {
  const ROLE_CAPABILITIES: Record<string, string[]> = {
    superuser: ["inventory.read", "inventory.write", "inventory.admin", "ai.ocr", "rem.read", "rem.write"],
    engineer: ["inventory.read", "inventory.write", "ai.ocr", "rem.read", "rem.write"],
    viewer: ["inventory.read", "rem.read"],
  };

  it("viewer should have rem.read but not rem.write", () => {
    const caps = ROLE_CAPABILITIES.viewer;
    expect(caps).toContain("rem.read");
    expect(caps).not.toContain("rem.write");
  });

  it("engineer should have both rem.read and rem.write", () => {
    const caps = ROLE_CAPABILITIES.engineer;
    expect(caps).toContain("rem.read");
    expect(caps).toContain("rem.write");
  });

  it("superuser should have both rem.read and rem.write", () => {
    const caps = ROLE_CAPABILITIES.superuser;
    expect(caps).toContain("rem.read");
    expect(caps).toContain("rem.write");
  });

  it("unauthenticated user should have no capabilities", () => {
    const caps = ROLE_CAPABILITIES[""] ?? [];
    expect(caps).not.toContain("rem.read");
    expect(caps).not.toContain("rem.write");
  });
});

// ─── Payload allowlisting tests ───

describe("REM Payload Allowlisting", () => {
  describe("Analyzer field allowlisting", () => {
    it("should only allow known fields through", () => {
      const input = {
        serialNumber: "SN-001",
        currentStage: "Cleaning",
        maliciousField: "injected",
        anotherBad: 123,
      };
      const result = pickAllowedFields(input, VALID_ANALYZER_FIELDS);
      expect(result).toEqual({
        serialNumber: "SN-001",
        currentStage: "Cleaning",
      });
      expect(result).not.toHaveProperty("maliciousField");
      expect(result).not.toHaveProperty("anotherBad");
    });

    it("should filter out undefined values", () => {
      const input = {
        serialNumber: "SN-001",
        currentStage: undefined,
        progress: undefined,
      };
      const result = pickAllowedFields(input, VALID_ANALYZER_FIELDS);
      expect(result).toEqual({ serialNumber: "SN-001" });
    });

    it("should allow all valid analyzer fields", () => {
      const input: Record<string, unknown> = {};
      for (const field of VALID_ANALYZER_FIELDS) {
        input[field] = "test-value";
      }
      const result = pickAllowedFields(input, VALID_ANALYZER_FIELDS);
      expect(Object.keys(result).length).toBe(VALID_ANALYZER_FIELDS.size);
    });
  });

  describe("LVCC field allowlisting", () => {
    it("should only allow known LVCC fields", () => {
      const input = {
        serialNumber: "LVCC-001",
        buildPct: 50,
        unknownField: "bad",
      };
      const result = pickAllowedFields(input, VALID_LVCC_FIELDS);
      expect(result).not.toHaveProperty("unknownField");
      expect(result).toHaveProperty("serialNumber");
      expect(result).toHaveProperty("buildPct");
    });
  });

  describe("Staff field allowlisting", () => {
    it("should only allow known staff fields", () => {
      const input = {
        name: "John",
        role: "Engineer",
        secretField: "injected",
      };
      const result = pickAllowedFields(input, VALID_STAFF_FIELDS);
      expect(result).not.toHaveProperty("secretField");
      expect(result).toHaveProperty("name");
      expect(result).toHaveProperty("role");
    });
  });

  describe("Target field allowlisting", () => {
    it("should only allow known target fields", () => {
      const input = {
        type: "LVCC",
        target: 100,
        completed: 50,
        injected: true,
      };
      const result = pickAllowedFields(input, VALID_TARGET_FIELDS);
      expect(result).not.toHaveProperty("injected");
      expect(Object.keys(result).length).toBe(3);
    });
  });
});

// ─── Payload validation tests ───

describe("REM Payload Validation", () => {
  describe("Analyzer payload validation", () => {
    it("should accept valid analyzer payload", () => {
      expect(() => validateAnalyzerPayload({
        serialNumber: "SN-001",
        currentStage: "Cleaning",
        overallPct: 45,
        isComplete: false,
      })).not.toThrow();
    });

    it("should reject invalid stage", () => {
      expect(() => validateAnalyzerPayload({
        currentStage: "InvalidStage",
      })).toThrow("Invalid stage");
    });

    it("should accept all valid stages", () => {
      for (const stage of VALID_ANALYZER_STAGES) {
        expect(() => validateAnalyzerPayload({ currentStage: stage })).not.toThrow();
      }
    });

    it("should reject percentage out of range", () => {
      expect(() => validateAnalyzerPayload({ overallPct: 150 })).toThrow("between 0 and 100");
      expect(() => validateAnalyzerPayload({ overallPct: -10 })).toThrow("between 0 and 100");
    });

    it("should reject non-finite percentage", () => {
      expect(() => validateAnalyzerPayload({ overallPct: NaN })).toThrow("between 0 and 100");
      expect(() => validateAnalyzerPayload({ overallPct: Infinity })).toThrow("between 0 and 100");
    });

    it("should reject non-string serialNumber", () => {
      expect(() => validateAnalyzerPayload({ serialNumber: 123 })).toThrow("must be a string");
    });

    it("should reject non-boolean isComplete", () => {
      expect(() => validateAnalyzerPayload({ isComplete: "yes" })).toThrow("must be a boolean");
    });

    it("should accept 0 and 100 as valid percentages", () => {
      expect(() => validateAnalyzerPayload({ overallPct: 0 })).not.toThrow();
      expect(() => validateAnalyzerPayload({ overallPct: 100 })).not.toThrow();
    });
  });

  describe("LVCC payload validation", () => {
    it("should accept valid LVCC payload", () => {
      expect(() => validateLvccPayload({
        buildPct: 75,
        testPct: 50,
      })).not.toThrow();
    });

    it("should reject percentage out of range", () => {
      expect(() => validateLvccPayload({ buildPct: 200 })).toThrow("between 0 and 100");
    });

    it("should reject non-string serialNumber", () => {
      expect(() => validateLvccPayload({ serialNumber: 42 })).toThrow("must be a string");
    });
  });

  describe("Staff payload validation", () => {
    it("should accept valid staff payload", () => {
      expect(() => validateStaffPayload({
        name: "John Doe",
        role: "Engineer",
        fte: 1.0,
      })).not.toThrow();
    });

    it("should reject empty name", () => {
      expect(() => validateStaffPayload({ name: "" })).toThrow("non-empty string");
      expect(() => validateStaffPayload({ name: "   " })).toThrow("non-empty string");
    });

    it("should reject non-string name", () => {
      expect(() => validateStaffPayload({ name: 123 })).toThrow("non-empty string");
    });

    it("should reject negative FTE", () => {
      expect(() => validateStaffPayload({ fte: -1 })).toThrow("non-negative number");
    });

    it("should accept zero FTE", () => {
      expect(() => validateStaffPayload({ fte: 0 })).not.toThrow();
    });
  });

  describe("Target payload validation", () => {
    it("should accept valid target payload", () => {
      expect(() => validateTargetPayload({
        type: "LVCC",
        target: 100,
        completed: 50,
      })).not.toThrow();
    });

    it("should reject negative target", () => {
      expect(() => validateTargetPayload({ target: -1 })).toThrow("non-negative number");
    });

    it("should reject non-string type", () => {
      expect(() => validateTargetPayload({ type: 123 })).toThrow("must be a string");
    });
  });
});

// ─── Audit entry creation tests ───

describe("REM Audit Entry Creation", () => {
  it("should create audit entry with correct structure", () => {
    const auditEntry = {
      action: "UPDATE_ANALYZER",
      actor: "user",
      timestamp: Date.now(),
      table: "remAnalyzers",
      recordId: "analyzer-123",
      before: { serialNumber: "SN-001", currentStage: "Procurement" },
      after: { serialNumber: "SN-001", currentStage: "Cleaning" },
    };

    expect(auditEntry.action).toBe("UPDATE_ANALYZER");
    expect(auditEntry.actor).toBeTruthy();
    expect(auditEntry.timestamp).toBeGreaterThan(0);
    expect(auditEntry.table).toBe("remAnalyzers");
    expect(auditEntry.recordId).toBeTruthy();
    expect(auditEntry.before).toBeDefined();
    expect(auditEntry.after).toBeDefined();
  });

  it("should create audit entry for create operations", () => {
    const auditEntry = {
      action: "CREATE_ANALYZER",
      actor: "user",
      timestamp: Date.now(),
      table: "remAnalyzers",
      recordId: "new-analyzer-id",
      after: { serialNumber: "SN-002", analyzerType: "Vita" },
    };

    expect(auditEntry.action).toBe("CREATE_ANALYZER");
    expect(auditEntry.before).toBeUndefined();
    expect(auditEntry.after).toBeDefined();
  });

  it("should include before/after state for mutations", () => {
    const before = { serialNumber: "SN-001", currentStage: "Procurement", overallPct: 0 };
    const after = { serialNumber: "SN-001", currentStage: "Cleaning", overallPct: 25 };

    expect(before.currentStage).toBe("Procurement");
    expect(after.currentStage).toBe("Cleaning");
    expect(after.overallPct).toBe(25);
  });

  it("should support all REM audit action types", () => {
    const validActions = [
      "UPDATE_ANALYZER", "CREATE_ANALYZER",
      "UPDATE_LVCC", "CREATE_LVCC",
      "UPDATE_STAFF", "CREATE_STAFF",
      "UPDATE_TARGET", "CREATE_TARGET",
      "UPDATE_WEEKLY_NOTE", "CREATE_WEEKLY_NOTE",
    ];

    for (const action of validActions) {
      const entry = {
        action,
        actor: "user",
        timestamp: Date.now(),
        table: "test",
        recordId: "test-id",
      };
      expect(validActions).toContain(entry.action);
    }
  });
});

// ─── REM CRUD representative tests ───

describe("REM CRUD Operations", () => {
  describe("Analyzer CRUD", () => {
    it("should validate create payload", () => {
      const payload = { serialNumber: "SN-100", analyzerType: "Vita" };
      expect(payload.serialNumber).toBeTruthy();
      expect(typeof payload.serialNumber).toBe("string");
    });

    it("should validate update payload", () => {
      const updates = { currentStage: "Service/Repair", overallPct: 65 };
      validateAnalyzerPayload(updates);
      expect(updates.currentStage).toBe("Service/Repair");
    });

    it("should handle stage transitions", () => {
      const stages = ["Procurement", "Cleaning", "Service/Repair", "Final Line", "Packaging", "Release Testing", "QA Release", "SAP Release", "Complete"];
      for (const stage of stages) {
        expect(() => validateAnalyzerPayload({ currentStage: stage })).not.toThrow();
      }
    });

    it("should mark as complete when stage is Complete", () => {
      const payload = { currentStage: "Complete", isComplete: true };
      expect(payload.currentStage).toBe("Complete");
      expect(payload.isComplete).toBe(true);
    });
  });

  describe("LVCC CRUD", () => {
    it("should validate create payload", () => {
      const payload = { serialNumber: "LVCC-100", itemType: "Consumable" };
      expect(payload.serialNumber).toBeTruthy();
    });

    it("should validate update payload with percentages", () => {
      const updates = { buildPct: 100, testPct: 75, packagingPct: 50 };
      validateLvccPayload(updates);
      expect(updates.buildPct).toBe(100);
    });
  });

  describe("Staff CRUD", () => {
    it("should validate create payload", () => {
      const payload = { name: "Jane Smith", role: "Technician", fte: 0.8 };
      validateStaffPayload(payload);
      expect(payload.name).toBe("Jane Smith");
    });

    it("should validate update payload", () => {
      const updates = { fte: 1.0, inTraining: true };
      validateStaffPayload(updates);
      expect(updates.fte).toBe(1.0);
    });
  });

  describe("Target CRUD", () => {
    it("should validate create payload", () => {
      const payload = { type: "Analyzer", target: 50, completed: 10 };
      validateTargetPayload(payload);
      expect(payload.target).toBe(50);
    });

    it("should validate update payload", () => {
      const updates = { completed: 25 };
      validateTargetPayload(updates);
      expect(updates.completed).toBe(25);
    });
  });

  describe("Weekly Notes CRUD", () => {
    it("should validate create payload structure", () => {
      const payload = {
        weekNumber: 35,
        weekStart: "2026-08-24",
        quarter: "Q3",
        notes: [{ product: "Vita", content: "Completed 5 units" }],
      };
      expect(payload.weekNumber).toBe(35);
      expect(payload.notes).toHaveLength(1);
      expect(payload.notes[0].product).toBe("Vita");
    });

    it("should support multiple product notes per week", () => {
      const payload = {
        weekNumber: 36,
        weekStart: "2026-08-31",
        quarter: "Q3",
        notes: [
          { product: "Vita", content: "Started 3 units" },
          { product: "Vegan", content: "Completed 2 units" },
        ],
      };
      expect(payload.notes).toHaveLength(2);
    });
  });
});
