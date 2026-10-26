import "server-only";
import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { FieldValue, getFirestore, type Firestore } from "firebase-admin/firestore";
import { parseServiceAccountJson } from "@/lib/statement-import-errors";

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
if (!projectId) throw new Error("NEXT_PUBLIC_FIREBASE_PROJECT_ID must be configured for secure statement imports.");

function getAdminApp() {
  const existing = getApps().find((app) => app.name === "household-hq-import");
  if (existing) return existing;
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  let credential;
  if (serviceAccountJson) {
    try {
      const serviceAccount = parseServiceAccountJson(serviceAccountJson);
      if (serviceAccount.projectId !== projectId) {
        throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON belongs to a different Firebase project than NEXT_PUBLIC_FIREBASE_PROJECT_ID.");
      }
      credential = cert(serviceAccount);
    } catch (cause) {
      if (cause instanceof Error && cause.message.startsWith("FIREBASE_SERVICE_ACCOUNT_JSON")) throw cause;
      throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not a valid Firebase service-account credential. Check the JSON fields and private key formatting.");
    }
  } else {
    credential = applicationDefault();
  }
  return initializeApp({ credential, projectId }, "household-hq-import");
}

export function getAdminAuth(): Auth {
  return getAuth(getAdminApp());
}

export function getAdminDb(): Firestore {
  return getFirestore(getAdminApp());
}

export { FieldValue };
