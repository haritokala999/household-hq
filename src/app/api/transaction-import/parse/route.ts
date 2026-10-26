import type { HouseholdCurrency } from "@/lib/types";
import {
  parseCapitalOnePdf,
  parseCsvStatement,
  importedTransactionId,
  statementContentHash,
  type ImportRow,
  type CsvColumnMapping,
} from "@/lib/statement-import";
import {
  MAX_IMPORTED_TRANSACTIONS,
  MAX_STATEMENT_BYTES,
  authorizeStatementImport,
  ImportApiError,
  routeErrorResponse,
} from "@/lib/statement-import-server";
import { getAdminDb } from "@/lib/firebase-admin";

const acceptedCsvTypes = new Set(["text/csv", "application/csv", "application/vnd.ms-excel", "application/octet-stream", ""]);

export async function POST(request: Request) {
  try {
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > MAX_STATEMENT_BYTES + 64 * 1024) {
      throw new ImportApiError("The statement exceeds the 4 MiB file limit.", 413);
    }
    const householdId = request.headers.get("x-household-id");
    if (!householdId) throw new ImportApiError("Choose a household before importing.", 400);
    const context = await authorizeStatementImport(request, householdId);
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new ImportApiError("The statement upload is malformed. Choose a PDF or CSV file and try again.", 400);
    }
    const file = form.get("file");
    if (!(file instanceof File)) throw new ImportApiError("Choose a PDF or CSV statement.", 400);
    if (file.size === 0) throw new ImportApiError("The selected statement is empty.", 400);
    if (file.size > MAX_STATEMENT_BYTES) throw new ImportApiError("The statement exceeds the 4 MiB file limit.", 413);
    if (!["USD", "CAD", "EUR", "GBP", "INR", "SAR", "KWD"].includes(context.currency)) {
      throw new ImportApiError("The household has an unsupported currency.", 400);
    }
    const fileName = file.name.toLowerCase();
    const buffer = Buffer.from(await file.arrayBuffer());
    let rows: ImportRow[];
    let statementPeriod = null;
    let statementHash = statementContentHash(buffer);
    let headers: string[] = [];
    let sample: string[][] = [];
    let mapping: CsvColumnMapping | null = null;
    if (fileName.endsWith(".pdf") && ["application/pdf", "application/octet-stream", ""].includes(file.type)) {
      let result;
      try {
        result = await parseCapitalOnePdf(buffer, context.currency as HouseholdCurrency);
      } catch (cause) {
        throw new ImportApiError(cause instanceof Error ? cause.message : "The PDF could not be parsed.", 400);
      }
      rows = result.rows;
      statementPeriod = result.statementPeriod;
      statementHash = result.statementHash;
    } else if (fileName.endsWith(".csv") && acceptedCsvTypes.has(file.type)) {
      const mappingValue = form.get("mapping");
      let providedMapping: CsvColumnMapping | undefined;
      if (typeof mappingValue === "string" && mappingValue) {
        try {
          providedMapping = JSON.parse(mappingValue) as CsvColumnMapping;
        } catch {
          throw new ImportApiError("Choose valid columns from the CSV header.", 400);
        }
      }
      try {
        const result = parseCsvStatement(buffer, context.currency as HouseholdCurrency, providedMapping);
        headers = result.headers;
        sample = result.sample;
        mapping = result.mapping;
        rows = result.rows;
        statementPeriod = result.statementPeriod;
      } catch (cause) {
        throw new ImportApiError(cause instanceof Error ? cause.message : "The CSV could not be parsed.", 400);
      }
      if (!mapping) {
        return Response.json({
          mappingRequired: true,
          headers,
          sample,
          rows: [],
          statementHash,
          statementPeriod: null,
        });
      }
    } else {
      throw new ImportApiError("Choose a PDF statement or a CSV export. The selected file type does not match its extension.", 415);
    }
    if (rows.length > MAX_IMPORTED_TRANSACTIONS * 2) {
      throw new ImportApiError(`The statement contains too many transaction rows. The limit is ${MAX_IMPORTED_TRANSACTIONS * 2}.`, 413);
    }

    const adminDb = getAdminDb();
    const existingIds = new Set<string>();
    const refs = rows.map((row) => adminDb.doc(`households/${householdId}/transactions/${importedTransactionId(householdId, statementHash, row.sourceRow)}`));
    for (let index = 0; index < refs.length; index += 250) {
      const snapshots = await adminDb.getAll(...refs.slice(index, index + 250));
      snapshots.forEach((snapshot) => { if (snapshot.exists) existingIds.add(snapshot.id); });
    }
    const markedRows = rows.map((row, index) => {
      const alreadyImported = existingIds.has(refs[index].id);
      return alreadyImported
        ? { ...row, alreadyImported, included: false, warnings: [...row.warnings, "This row was already imported from this statement."] }
        : row;
    });
    return Response.json({ mappingRequired: false, rows: markedRows, statementHash, statementPeriod, headers, sample });
  } catch (cause) {
    return routeErrorResponse(cause);
  }
}
