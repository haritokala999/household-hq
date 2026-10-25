import {
  collection,
  doc,
  getDoc,
  getDocs,
  type Firestore,
} from "firebase/firestore";
import type { HouseholdCurrency, HouseholdMembership } from "./types";
import type { HouseholdMember } from "./types";

/** Read the authenticated user's private index and its canonical records. */
export async function getHouseholdsForUser(
  database: Firestore,
  uid: string,
): Promise<HouseholdMembership[]> {
  const index = await getDocs(collection(database, "users", uid, "households"));

  return Promise.all(index.docs.map(async (indexSnapshot) => {
    const householdId = indexSnapshot.id;
    if (indexSnapshot.data().householdId !== householdId) {
      throw new Error("A household index entry has an invalid household ID.");
    }

    const [householdSnapshot, membershipSnapshot] = await Promise.all([
      getDoc(doc(database, "households", householdId)),
      getDoc(doc(database, "households", householdId, "members", uid)),
    ]);

    if (!householdSnapshot.exists() || !membershipSnapshot.exists()) {
      throw new Error("A household index entry is missing its household membership.");
    }

    const household = householdSnapshot.data();
    const membership = membershipSnapshot.data();

    if (membership.status !== "active") {
      throw new Error("A household index entry points to an inactive membership.");
    }

    return {
      uid: membership.uid as string,
      email: (membership.email as string | null) ?? null,
      displayName: (membership.displayName as string | null) ?? null,
      role: membership.role as HouseholdMembership["role"],
      status: membership.status as HouseholdMembership["status"],
      joinedAt: membership.joinedAt,
      householdId,
      householdName: household.name as string,
      currency: household.currency as HouseholdCurrency,
    };
  }));
}

export async function getHouseholdMembers(
  database: Firestore,
  householdId: string,
): Promise<HouseholdMember[]> {
  const snapshot = await getDocs(collection(database, "households", householdId, "members"));
  return snapshot.docs.map((item) => ({
    uid: item.id,
    email: (item.data().email as string | null) ?? null,
    displayName: (item.data().displayName as string | null) ?? null,
    role: item.data().role as HouseholdMember["role"],
    status: item.data().status as HouseholdMember["status"],
  }));
}
