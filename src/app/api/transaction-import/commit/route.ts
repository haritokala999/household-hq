import { isCalendarDate, TRANSACTION_CATEGORIES } from "@/lib/finance";
import { importedTransactionId, type ImportTransactionType } from "@/lib/statement-import";
import {
  MAX_IMPORTED_TRANSACTIONS,
  authorizeStatementImport,
  ImportApiError,
  routeErrorResponse,
} from "@/lib/statement-import-server";
import { FieldValue, getAdminDb } from "@/lib/firebase-admin";

type ImportRequestRow = {
  sourceRow: number;
  date: string;
  description: string;
  amountMinor: number;
  type: ImportTransactionType;
  category: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function POST(request: Request) {
  try {
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > 512 * 1024) throw new ImportApiError("Choose no more than 250 transactions to import.", 413);
    const authorizedHouseholdId = request.headers.get("x-household-id");
    if (!authorizedHouseholdId) throw new ImportApiError("Choose a household before importing.", 400);
    const { uid } = await authorizeStatementImport(request, authorizedHouseholdId);
    let bodyText: string;
    try {
      bodyText = await request.text();
    } catch {
      throw new ImportApiError("The import request is invalid. Review the statement and retry.", 400);
    }
    if (bodyText.length > 512 * 1024) throw new ImportApiError("Choose no more than 250 transactions to import.", 413);
    let body: unknown;
    try {
      body = JSON.parse(bodyText) as unknown;
    } catch {
      throw new ImportApiError("The import request is invalid. Review the statement and retry.", 400);
    }
    if (!isRecord(body)) throw new ImportApiError("The import request is invalid.", 400);
    const { householdId, statementHash, rows } = body;
    if (householdId !== authorizedHouseholdId) {
      throw new ImportApiError("The import request does not match the authorized household.", 403);
    }
    if (typeof statementHash !== "string" || !/^[a-f0-9]{64}$/.test(statementHash)) {
      throw new ImportApiError("The statement reference is invalid. Upload the statement again.", 400);
    }
    if (!Array.isArray(rows) || rows.length === 0 || rows.length > MAX_IMPORTED_TRANSACTIONS) {
      throw new ImportApiError(`Select between 1 and ${MAX_IMPORTED_TRANSACTIONS} transactions to import.`, 400);
    }

    const validatedRows: ImportRequestRow[] = [];
    const sourceRows = new Set<number>();
    for (const value of rows) {
      if (!isRecord(value)
        || !Number.isSafeInteger(value.sourceRow)
        || Number(value.sourceRow) < 1
        || sourceRows.has(Number(value.sourceRow))
        || typeof value.date !== "string"
        || !isCalendarDate(value.date)
        || typeof value.description !== "string"
        || !value.description.trim()
        || value.description.length > 240
        || !Number.isSafeInteger(value.amountMinor)
        || Number(value.amountMinor) <= 0
        || !["debit", "income", "refund"].includes(String(value.type))
        || typeof value.category !== "string"
        || !(TRANSACTION_CATEGORIES as readonly string[]).includes(value.category)
      ) {
        throw new ImportApiError("A selected transaction has an invalid date, description, amount, type, or category.", 400);
      }
      sourceRows.add(Number(value.sourceRow));
      validatedRows.push({
        sourceRow: Number(value.sourceRow),
        date: value.date,
        description: value.description.trim(),
        amountMinor: Number(value.amountMinor),
        type: value.type as ImportTransactionType,
        category: value.category,
      });
    }

    const householdIdValue = householdId as string;
    const adminDb = getAdminDb();
    const refs = validatedRows.map((row) => adminDb.doc(`households/${householdIdValue}/transactions/${importedTransactionId(householdIdValue, statementHash, row.sourceRow)}`));
    const { imported, skipped } = await adminDb.runTransaction(async (transaction) => {
      const snapshots = await transaction.getAll(...refs);
      let imported = 0;
      let skipped = 0;
      validatedRows.forEach((row, index) => {
        if (snapshots[index].exists) {
          skipped += 1;
          return;
        }
        transaction.create(refs[index], {
          type: row.type === "income" || row.type === "refund" ? "credit" : "debit",
          purpose: row.type === "refund" ? "ordinary" : row.type === "income" ? "income" : "ordinary",
          transferDestination: null,
          category: row.category,
          description: row.description,
          amountMinor: row.amountMinor,
          date: row.date,
          accountId: null,
          ownerUid: uid,
          createdBy: uid,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        imported += 1;
      });
      return { imported, skipped };
    });
    return Response.json({ imported, skipped, failed: 0 });
  } catch (cause) {
    return routeErrorResponse(cause);
  }
}
