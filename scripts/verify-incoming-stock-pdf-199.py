#!/usr/bin/env python3
"""Independent deterministic verifier for PR #199 exact implementation head."""
from __future__ import annotations

import subprocess
import sys

TARGET = "f1925dbd836b41895daa450734fb11ea8397438b"
BASE = "8f8d16bc48779b25937efc6444acdcf5a33c374f"
EXPECTED_TARGET_FILES = {
    ".github/workflows/ci.yml",
    "convex/_generated/api.d.ts",
    "convex/incomingStockPdfOcr.ts",
    "scripts/incoming-stock-pdf-security-check.mjs",
    "src/App.tsx",
    "src/pages/inventory/IncomingStockDocument.tsx",
}
EXPECTED_VERIFIER_FILES = {
    "scripts/verify-incoming-stock-pdf-199.py",
    ".github/workflows/verify-incoming-stock-pdf-199.yml",
}


def git(*args: str) -> str:
    return subprocess.check_output(["git", *args], text=True).strip()


def show(path: str) -> str:
    return git("show", f"{TARGET}:{path}")


def require(value: bool, message: str) -> None:
    if not value:
        raise AssertionError(message)


def require_all(text: str, needles: list[str], label: str) -> None:
    missing = [needle for needle in needles if needle not in text]
    require(not missing, f"{label} missing invariants: {missing}")


def main() -> int:
    require(git("cat-file", "-t", TARGET) == "commit", "exact target SHA missing")
    target_files = set(filter(None, git("diff", "--name-only", BASE, TARGET).splitlines()))
    require(target_files == EXPECTED_TARGET_FILES, f"unexpected PR #199 target diff: {sorted(target_files)}")
    verifier_files = set(filter(None, git("diff", "--name-only", TARGET, "HEAD").splitlines()))
    require(verifier_files == EXPECTED_VERIFIER_FILES, f"verifier branch scope drift: {sorted(verifier_files)}")

    ci = show(".github/workflows/ci.yml")
    api = show("convex/_generated/api.d.ts")
    server = show("convex/incomingStockPdfOcr.ts")
    ui = show("src/pages/inventory/IncomingStockDocument.tsx")
    app = show("src/App.tsx")

    require_all(ci, [
        "REM workbook import security check",
        "DHR atomic scanner security check",
        "DHR lifecycle revision security check",
        "Incoming Stock PDF security check",
        "incoming-stock-pdf-security-check.mjs",
    ], "current CI preservation")
    require_all(api, [
        'incomingStockPdfOcr from "../incomingStockPdfOcr.js"',
        "incomingStockPdfOcr: typeof incomingStockPdfOcr",
        'remReadActions from "../remReadActions.js"',
        'remWorkbookActions from "../remWorkbookActions.js"',
    ], "generated API preservation")
    require_all(server, [
        'requireCapability(ctx, "ai.ocr")',
        "process.env.OPENAI_API_KEY",
        'type: "input_file"',
        "MAX_PDF_SIZE_BYTES",
        "MAX_PROMPT_LENGTH",
        "MAX_REFERENCE_PARTS",
        "Receiving quantity is SHIP QTY / SHIPPED QTY",
        "Do not collapse repeated part lines",
        "Read every page of the PDF",
    ], "server PDF OCR")
    require("VITE_OPENAI_KEY" not in server and "SUPABASE_SERVICE_ROLE_KEY" not in server, "server PDF OCR leaks unrelated/browser secrets")
    require_all(ui, [
        'accept="application/pdf,.pdf"',
        "reviewPackingListDraft",
        "commitConfirmedReceiveLine",
        'review.identityRule !== "canonical_part_number_only"',
        'line.matchStatus === "matched"',
        "Nothing changes inventory until you confirm",
        "IncomingStockSecure",
    ], "human-confirmation UI")
    require("api.openai.com" not in ui and "OPENAI_API_KEY" not in ui and "SUPABASE_SERVICE_ROLE_KEY" not in ui, "browser PDF UI contains server credential/provider call")
    require_all(app, [
        'import { IncomingStockDocument } from "./pages/inventory/IncomingStockDocument"',
        '<Route path="/incoming-stock" element={<IncomingStockDocument />} />',
    ], "Incoming Stock route")

    print(f"VERIFY=PASS SHA={TARGET}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"VERIFY=FAIL SHA={TARGET} REASON={exc}", file=sys.stderr)
        raise
