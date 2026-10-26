import "server-only";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";
import { FIREBASE_ADMIN_SETUP_ERROR, isFirebaseAdminCredentialError } from "@/lib/statement-import-errors";

export class ImportApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ImportApiError";
  }
}

export function validateDocumentId(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value.length > 128 || /[/.#?[\]]/.test(value)) {
    throw new ImportApiError(`Choose a valid ${label}.`, 400);
  }
}

export async function authorizeStatementImport(request: Request, householdId: unknown) {
  validateDocumentId(householdId, "household");
  const authorization = request.headers.get("authorization") ?? "";
  const token = /^Bearer\s+(.+)$/i.exec(authorization)?.[1];
  if (!token) throw new ImportApiError("Sign in to import a statement.", 401);
  let decoded;
  try {
    decoded = await getAdminAuth().verifyIdToken(token);
  } catch (cause) {
    if (isFirebaseAdminCredentialError(cause)) throw cause;
    throw new ImportApiError("Your sign-in has expired. Sign in again and retry.", 401);
  }
  const adminDb = getAdminDb();
  const [membershipSnapshot, householdSnapshot] = await Promise.all([
    adminDb.doc(`households/${householdId}/members/${decoded.uid}`).get(),
    adminDb.doc(`households/${householdId}`).get(),
  ]);
  if (!membershipSnapshot.exists || membershipSnapshot.data()?.uid !== decoded.uid || membershipSnapshot.data()?.status !== "active") {
    throw new ImportApiError("You do not have access to this household.", 403);
  }
  if (!householdSnapshot.exists) throw new ImportApiError("The selected household no longer exists.", 404);
  return {
    uid: decoded.uid,
    currency: householdSnapshot.data()?.currency,
  };
}

export function routeErrorResponse(cause: unknown) {
  if (cause instanceof ImportApiError) {
    return Response.json({ error: cause.message }, { status: cause.status });
  }
  if (cause instanceof Error && cause.message.startsWith("Statement import:")) {
    return Response.json({ error: cause.message.slice("Statement import:".length).trim() }, { status: 400 });
  }
  if (cause instanceof Error && cause.message.startsWith("FIREBASE_SERVICE_ACCOUNT_JSON")) {
    return Response.json({ error: cause.message }, { status: 503 });
  }
  if (isFirebaseAdminCredentialError(cause)) {
    return Response.json({ error: FIREBASE_ADMIN_SETUP_ERROR }, { status: 503 });
  }
  if (cause instanceof Error) {
    const error = cause as Error & { code?: unknown };
    console.error("Statement import request failed.", {
      name: error.name,
      code: typeof error.code === "string" ? error.code : undefined,
    });
  } else {
    console.error("Statement import request failed with a non-Error value.");
  }
  return Response.json({ error: "The statement could not be processed. Try again or use a CSV export." }, { status: 500 });
}

export const MAX_STATEMENT_BYTES = 10 * 1024 * 1024;
export const MAX_IMPORTED_TRANSACTIONS = 250;
