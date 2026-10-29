
import {
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  getRedirectResult,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  updateProfile,
} from "firebase/auth";
import { auth, googleProvider } from "@/lib/firebase";

export async function signInWithGoogle() {
  await setPersistence(auth, browserLocalPersistence);
  googleProvider.setCustomParameters({
    prompt: "select_account",
  });

  const isInstalledApp = typeof window !== "undefined"
    && (window.matchMedia("(display-mode: standalone)").matches
      || ((navigator as Navigator & { standalone?: boolean }).standalone === true));
  if (isInstalledApp) {
    await signInWithRedirect(auth, googleProvider);
    return null;
  }

  try {
    return await signInWithPopup(auth, googleProvider);
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? error.code
        : undefined;

    if (
      code === "auth/popup-blocked" ||
      code === "auth/operation-not-supported-in-this-environment"
    ) {
      await signInWithRedirect(auth, googleProvider);
      return null;
    }

    throw error;
  }
}

export function getGoogleRedirectResult() {
  return getRedirectResult(auth);
}

export async function signInWithEmail(
  email: string,
  password: string,
) {
  await setPersistence(auth, browserLocalPersistence);
  return signInWithEmailAndPassword(auth, email, password);
}

export async function createEmailAccount(
  name: string,
  email: string,
  password: string,
) {
  await setPersistence(auth, browserLocalPersistence);
  const credential = await createUserWithEmailAndPassword(
    auth,
    email,
    password,
  );

  await updateProfile(credential.user, {
    displayName: name,
  });

  return credential;
}

export async function signOutUser() {
  return signOut(auth);
}
