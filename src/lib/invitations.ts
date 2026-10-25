import {
  doc,
  getDoc,
  serverTimestamp,
  Timestamp,
  writeBatch,
  type Firestore,
} from "firebase/firestore";

export const INVITATION_LIFETIME_DAYS = 7;
export const INVITATION_CODE_LENGTH = 22;

function createInvitationCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function createHouseholdInvitation(
  database: Firestore,
  householdId: string,
  creatorUid: string,
) {
  const code = createInvitationCode();
  const invitationRef = doc(database, "householdInvitationCodes", code);
  const batch = writeBatch(database);
  batch.set(invitationRef, {
    code,
    householdId,
    createdBy: creatorUid,
    createdAt: serverTimestamp(),
    expiresAt: Timestamp.fromMillis(Date.now() + INVITATION_LIFETIME_DAYS * 24 * 60 * 60 * 1000),
    status: "pending",
    acceptedBy: null,
    acceptedAt: null,
  });

  try {
    await batch.commit();
    return code;
  } catch (writeError) {
    // Resolve an ambiguous response by checking the known random document ID.
    try {
      const existing = await getDoc(invitationRef);
      if (existing.exists()) {
        const saved = existing.data();
        if (
          saved.householdId === householdId
          && saved.createdBy === creatorUid
          && saved.code === code
          && saved.status === "pending"
        ) {
          return code;
        }
      }
    } catch {
      // Keep the original write error when its outcome cannot be read.
    }
    throw writeError;
  }
}

export async function acceptHouseholdInvitation(
  database: Firestore,
  invitationCode: string,
  user: {
    uid: string;
    email: string | null;
    displayName: string | null;
  },
) {
  const code = invitationCode.trim();
  if (!new RegExp(`^[A-Za-z0-9_-]{${INVITATION_CODE_LENGTH}}$`).test(code)) {
    throw new Error(`Enter the ${INVITATION_CODE_LENGTH}-character invitation code.`);
  }

  const invitationSnapshot = await getDoc(doc(database, "householdInvitationCodes", code));
  if (!invitationSnapshot.exists()) throw new Error("Invitation code not found.");
  const invitationRef = invitationSnapshot.ref;
  const invitation = invitationSnapshot.data();
  const householdId = invitation.householdId as string;

  if (invitation.status === "accepted" && invitation.acceptedBy === user.uid) {
    const [membership, index] = await Promise.all([
      getDoc(doc(database, "households", householdId, "members", user.uid)),
      getDoc(doc(database, "users", user.uid, "households", householdId)),
    ]);
    if (membership.exists() && index.exists()) return householdId;
  }
  if (invitation.status !== "pending") throw new Error("This invitation has already been used.");
  if (!(invitation.expiresAt instanceof Timestamp) || invitation.expiresAt.toMillis() <= Date.now()) {
    throw new Error("This invitation has expired.");
  }

  const membershipRef = doc(database, "households", householdId, "members", user.uid);
  const indexRef = doc(database, "users", user.uid, "households", householdId);
  const batch = writeBatch(database);
  batch.update(invitationRef, {
    status: "accepted",
    acceptedBy: user.uid,
    acceptedAt: serverTimestamp(),
  });
  batch.set(membershipRef, {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    role: "member",
    status: "active",
    joinedAt: serverTimestamp(),
    invitationId: invitationSnapshot.id,
  });
  batch.set(indexRef, {
    householdId,
    createdAt: serverTimestamp(),
  });
  await batch.commit();
  return householdId;
}
