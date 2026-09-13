import type { RemOperationalRecord } from "./remOperationalWorkbook";

export type OperationalImportProgress = {
  importId: string;
  planYear: number;
  expectedRows: number;
  receivedRows: number;
  nextBatchIndex: number;
  status: "staging" | "applied";
};

type Begin = (args: { fileHash: string; planYear: number; expectedRows: number }) => Promise<OperationalImportProgress>;
type Stage = (args: { importId: string; batchIndex: number; records: RemOperationalRecord[] }) => Promise<OperationalImportProgress>;

// A lost response is recovered by beginning the same fingerprint again. Only
// server-confirmed progress is skipped; no sensitive rows enter browser storage.
export async function uploadRemOperationalRecords(
  input: { fileHash: string; planYear: number; records: RemOperationalRecord[] },
  begin: Begin,
  stage: Stage,
  onProgress: (received: number, total: number) => void,
): Promise<string> {
  const total = input.records.length;
  if (total < 1) throw new Error("No operational workbook rows to upload");
  let progress = await begin({ fileHash: input.fileHash, planYear: input.planYear, expectedRows: total });
  const importId = progress.importId;
  const check = () => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(progress.importId) || progress.importId !== importId
      || progress.planYear !== input.planYear || progress.expectedRows !== total
      || !Number.isInteger(progress.receivedRows) || progress.receivedRows < 0 || progress.receivedRows > total
      || !Number.isInteger(progress.nextBatchIndex) || progress.nextBatchIndex < 0
      || progress.nextBatchIndex > Math.ceil(total / 250)
      || progress.receivedRows !== Math.min(total, progress.nextBatchIndex * 250)
      || !["staging", "applied"].includes(progress.status)
      || (progress.status === "applied" && progress.receivedRows !== total)) {
      throw new Error("The server returned an inconsistent workbook upload receipt. Retry the same workbook to recover.");
    }
  };
  check();
  onProgress(progress.receivedRows, total);
  while (progress.receivedRows < total) {
    const batchIndex = progress.nextBatchIndex;
    const rows = input.records.slice(progress.receivedRows, progress.receivedRows + 250);
    progress = await stage({ importId, batchIndex, records: rows });
    check();
    if (progress.nextBatchIndex < batchIndex + 1) {
      throw new Error("The workbook batch was not confirmed. Retry the same workbook to recover.");
    }
    onProgress(progress.receivedRows, total);
  }
  return importId;
}
