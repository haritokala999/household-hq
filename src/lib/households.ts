import {
  doc,
  getDoc,
  getDocs,
  collection,
  serverTimestamp,
  updateDoc,
  writeBatch,
  type Firestore,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { getHouseholdsForUser } from "@/lib/household-memberships";
export { getHouseholdsForUser } from "@/lib/household-memberships";
import {
  DEFAULT_CATEGORIES,
  HOUSEHOLD_CURRENCIES,
  type HouseholdCurrency,
  type HouseholdMembership,
} from "@/lib/types";

const MAX_HOUSEHOLD_NAME_LENGTH = 80;
const PENDING_CREATION_PREFIX = "household-hq.pending-create";

type PendingCreation = {
  householdId: string;
  name: string;
  currency: HouseholdCurrency;
};

function userHouseholdRef(database: Firestore, uid: string, householdId: string) {
  return doc(database, "users", uid, "households", householdId);
}

export async function getMyHouseholds(): Promise<HouseholdMembership[]> {
  const user = auth.currentUser;

  if (!user) {
    throw new Error("You must be signed in to view your households.");
  }

  return getHouseholdsForUser(db, user.uid);
}

function normalizeHouseholdInput(name: string, currency: string) {
  const householdName = name.trim();

  if (!householdName) {
    throw new Error("Please enter a household name.");
  }
  if (householdName.length > MAX_HOUSEHOLD_NAME_LENGTH) {
    throw new Error(`Household names must be ${MAX_HOUSEHOLD_NAME_LENGTH} characters or fewer.`);
  }
  if (!HOUSEHOLD_CURRENCIES.some((supported) => supported === currency)) {
    throw new Error("Choose a supported household currency.");
  }

  return { name: householdName, currency: currency as HouseholdCurrency };
}

function pendingCreationStorageKey(uid: string) {
  return `${PENDING_CREATION_PREFIX}:${uid}`;
}

function getOrCreatePendingCreation(
  uid: string,
  name: string,
  currency: HouseholdCurrency,
): PendingCreation {
  if (typeof window === "undefined") {
    throw new Error("Household creation must be started in a browser.");
  }

  const storageKey = pendingCreationStorageKey(uid);
  let saved: string | null;
  try {
    saved = window.localStorage.getItem(storageKey);
  } catch {
    throw new Error("Browser storage is unavailable, so creation cannot be retried safely. Enable site storage and retry.");
  }
  if (saved) {
    let pending: PendingCreation;
    try {
      pending = JSON.parse(saved) as PendingCreation;
    } catch {
      throw new Error("A previous household creation needs to be resolved. Please reload and retry it.");
    }

    if (
      pending.name !== name
      || pending.currency !== currency
      || typeof pending.householdId !== "string"
      || !pending.householdId
    ) {
      throw new Error("A previous creation is unresolved. Retry it with the same name and currency before starting another household.");
    }

    return pending;
  }

  const pending = { householdId: crypto.randomUUID(), name, currency };
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(pending));
  } catch {
    throw new Error("Browser storage is unavailable, so creation cannot be retried safely. Enable site storage and retry.");
  }
  return pending;
}

function clearPendingCreation(storageKey: string) {
  try {
    window.localStorage.removeItem(storageKey);
  } catch {
    // Leaving a resolved attempt in storage is safe: its stable ID is reused.
  }
}

function isPermissionDenied(cause: unknown): boolean {
  return typeof cause === "object"
    && cause !== null
    && "code" in cause
    && cause.code === "permission-denied";
}

function permissionDeniedMessage(stage: "create" | "categories") {
  return stage === "create"
    ? "Firestore denied household creation. Deploy the current Firestore rules to the Firebase project used by this app, then retry with the same household name and currency."
    : "The household was created, but Firestore denied default category setup. Deploy the current Firestore rules to the Firebase project used by this app, then retry with the same household name and currency.";
}

async function findCompletedAttempt(
  uid: string,
  pending: PendingCreation,
): Promise<boolean> {
  const indexSnapshot = await getDoc(
    userHouseholdRef(db, uid, pending.householdId),
  );
  if (!indexSnapshot.exists()) return false;

  const [householdSnapshot, membershipSnapshot] = await Promise.all([
    getDoc(doc(db, "households", pending.householdId)),
    getDoc(doc(db, "households", pending.householdId, "members", uid)),
  ]);

  if (!householdSnapshot.exists() || !membershipSnapshot.exists()) {
    throw new Error("The previous household creation is incomplete and needs support.");
  }

  const household = householdSnapshot.data();
  const membership = membershipSnapshot.data();
  if (
    household.ownerUid !== uid
    || household.name !== pending.name
    || household.currency !== pending.currency
    || membership.uid !== uid
    || membership.role !== "owner"
    || membership.status !== "active"
  ) {
    throw new Error("The saved creation ID belongs to a different household. No new household was created.");
  }

  return true;
}

async function ensureDefaultCategories(householdId: string, uid: string) {
  const existing = await getDocs(collection(db, "households", householdId, "categories"));
  const present = new Set(existing.docs.map((item) => item.id));
  const missing = DEFAULT_CATEGORIES.filter((category) => !present.has(category.id));
  if (!missing.length) return;
  const batch = writeBatch(db);
  for (const category of missing) {
    batch.set(doc(db, "households", householdId, "categories", category.id), {
      name: category.name,
      kind: category.kind,
      isDefault: true,
      createdBy: uid,
      createdAt: serverTimestamp(),
    });
  }
  await batch.commit();
}

export async function createHousehold(
  name: string,
  currency: string = "USD",
) {
  const user = auth.currentUser;
  if (!user) {
    throw new Error("You must be signed in to create a household.");
  }

  const normalized = normalizeHouseholdInput(name, currency);
  const pending = getOrCreatePendingCreation(
    user.uid,
    normalized.name,
    normalized.currency,
  );
  const householdRef = doc(db, "households", pending.householdId);
  const memberRef = doc(db, "households", pending.householdId, "members", user.uid);
  const indexRef = userHouseholdRef(db, user.uid, pending.householdId);
  const storageKey = pendingCreationStorageKey(user.uid);

  // A prior commit may have succeeded while its response was lost. Resolve
  // the stable attempt ID before sending the same atomic batch again.
  try {
    if (await findCompletedAttempt(user.uid, pending)) {
      try {
        await ensureDefaultCategories(pending.householdId, user.uid);
      } catch (cause) {
        if (isPermissionDenied(cause)) throw new Error(permissionDeniedMessage("categories"));
        throw cause;
      }
      clearPendingCreation(storageKey);
      return pending.householdId;
    }
  } catch (cause) {
    if (isPermissionDenied(cause)) throw new Error(permissionDeniedMessage("create"));
    throw cause;
  }

  const batch = writeBatch(db);
  batch.set(householdRef, {
    name: pending.name,
    currency: pending.currency,
    ownerUid: user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  batch.set(memberRef, {
    uid: user.uid,
    email: user.email ?? null,
    displayName: user.displayName ?? null,
    role: "owner",
    status: "active",
    joinedAt: serverTimestamp(),
    invitationId: null,
  });
  batch.set(indexRef, {
    householdId: pending.householdId,
    createdAt: serverTimestamp(),
  });
  try {
    await batch.commit();
  } catch (writeError) {
    // Do not rotate the ID after an ambiguous response. A retry first checks
    // this same ID and can safely return the committed household if present.
    let completedAttempt: boolean;
    try {
      completedAttempt = await findCompletedAttempt(user.uid, pending);
    } catch {
      throw new Error("The household creation outcome could not be confirmed. Retry with the same name and currency to check the same request.");
    }
    if (completedAttempt) {
      try {
        await ensureDefaultCategories(pending.householdId, user.uid);
      } catch (cause) {
        if (isPermissionDenied(cause)) throw new Error(permissionDeniedMessage("categories"));
        throw cause;
      }
      clearPendingCreation(storageKey);
      return pending.householdId;
    }
    if (isPermissionDenied(writeError)) throw new Error(permissionDeniedMessage("create"));
    throw writeError;
  }

  try {
    await ensureDefaultCategories(pending.householdId, user.uid);
  } catch (cause) {
    if (isPermissionDenied(cause)) throw new Error(permissionDeniedMessage("categories"));
    throw cause;
  }
  clearPendingCreation(storageKey);
  return pending.householdId;
}

export async function renameHousehold(householdId: string, name: string) {
  const user = auth.currentUser;
  if (!user) throw new Error("You must be signed in to rename a household.");

  const householdName = name.trim();
  if (!householdName) throw new Error("Please enter a household name.");
  if (householdName.length > MAX_HOUSEHOLD_NAME_LENGTH) {
    throw new Error(`Household names must be ${MAX_HOUSEHOLD_NAME_LENGTH} characters or fewer.`);
  }

  await updateDoc(doc(db, "households", householdId), {
    name: householdName,
    updatedAt: serverTimestamp(),
  });
}

export async function transferHouseholdOwnership(householdId: string, newOwnerUid: string) {
  const user = auth.currentUser;
  if (!user) throw new Error("You must be signed in to transfer household ownership.");
  if (user.uid === newOwnerUid) throw new Error("Choose another active household member.");

  const batch = writeBatch(db);
  batch.update(doc(db, "households", householdId), {
    ownerUid: newOwnerUid,
    updatedAt: serverTimestamp(),
  });
  batch.update(doc(db, "households", householdId, "members", user.uid), {
    role: "member",
  });
  batch.update(doc(db, "households", householdId, "members", newOwnerUid), {
    role: "owner",
  });
  await batch.commit();
}

export async function promoteHouseholdMemberToOwner(householdId: string, memberUid: string) {
  const user = auth.currentUser;
  if (!user) throw new Error("You must be signed in to promote a household member.");
  if (user.uid === memberUid) throw new Error("You are already the household owner.");

  await updateDoc(doc(db, "households", householdId, "members", memberUid), {
    role: "owner",
  });
}
