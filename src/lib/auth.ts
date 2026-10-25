
import {
  browserSessionPersistence,
  createUserWithEmailAndPassword,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
} from "firebase/auth";
import { auth, googleProvider } from "@/lib/firebase";

export async function signInWithGoogle() {
  await setPersistence(auth, browserSessionPersistence);
  googleProvider.setCustomParameters({
    prompt: "select_account",
  });

  return signInWithPopup(auth, googleProvider);
}

export async function signInWithEmail(
  email: string,
  password: string,
) {
  await setPersistence(auth, browserSessionPersistence);
  return signInWithEmailAndPassword(auth, email, password);
}

export async function createEmailAccount(
  name: string,
  email: string,
  password: string,
) {
  await setPersistence(auth, browserSessionPersistence);
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
