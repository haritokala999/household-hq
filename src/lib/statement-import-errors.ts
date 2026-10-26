import type { ServiceAccount } from "firebase-admin/app";

const firebaseAdminCredentialPattern = /could not load the default credentials|default credentials|could not determine project id|unable to detect a project id|app\/invalid-credential|firebase_service_account_json|firebase service-account credential/i;

export const FIREBASE_ADMIN_SETUP_ERROR =
  "Statement import server credentials could not be loaded. Check that FIREBASE_SERVICE_ACCOUNT_JSON contains valid Firebase service-account JSON, or configure Firebase Application Default Credentials, then restart the server.";

export function parseServiceAccountJson(value: string): ServiceAccount {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    try {
      const normalized = value.replace(/\\\r?\n/g, "\\n").replace(/\\"/g, '"');
      parsed = JSON.parse(normalized);
    } catch {
      throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is malformed. Use valid JSON with unescaped property quotes; keep the private key's newline escapes intact.");
    }
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON must contain a Firebase service-account object.");
  }
  const credential = parsed as Record<string, unknown>;
  if (typeof credential.project_id !== "string"
    || typeof credential.client_email !== "string"
    || typeof credential.private_key !== "string") {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is missing required service-account fields.");
  }
  const privateKey = credential.private_key.replace(/\\n/g, "\n");
  return {
    projectId: credential.project_id,
    clientEmail: credential.client_email,
    privateKey,
  };
}

export function isFirebaseAdminCredentialError(cause: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = cause;
  while (current && !seen.has(current)) {
    seen.add(current);
    if (typeof current === "object") {
      const error = current as { message?: unknown; code?: unknown; cause?: unknown };
      const message = typeof error.message === "string" ? error.message : "";
      const code = typeof error.code === "string" ? error.code : "";
      if (firebaseAdminCredentialPattern.test(`${message} ${code}`)) return true;
      current = error.cause;
    } else {
      return false;
    }
  }
  return false;
}
