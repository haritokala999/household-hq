import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
  type Firestore,
} from "firebase/firestore";
import type { HouseholdActivity } from "@/lib/types";

function activityCollection(householdId: string) {
  return ["households", householdId, "activity"] as const;
}

export async function recordHouseholdActivity(
  database: Firestore,
  householdId: string,
  actorUid: string,
  actorName: string,
  summary: string,
) {
  const trimmedSummary = summary.trim();
  if (!trimmedSummary) throw new Error("Activity updates need a summary.");
  await addDoc(collection(database, ...activityCollection(householdId)), {
    actorUid,
    actorName: actorName.trim().slice(0, 80) || "Household member",
    summary: trimmedSummary.slice(0, 180),
    createdAt: serverTimestamp(),
  });
}

export async function loadHouseholdActivity(database: Firestore, householdId: string, uid: string) {
  const indexReference = doc(database, "users", uid, "households", householdId);
  const indexSnapshot = await getDoc(indexReference);
  const lastSeenAt = indexSnapshot.data()?.lastSeenAt as Timestamp | undefined;
  const feedQuery = query(
    collection(database, ...activityCollection(householdId)),
    orderBy("createdAt", "desc"),
    limit(30),
  );
  const feedSnapshot = await getDocs(feedQuery);
  const updatesSinceLastVisit = lastSeenAt
    ? await getDocs(query(
      collection(database, ...activityCollection(householdId)),
      where("createdAt", ">", lastSeenAt),
      orderBy("createdAt", "desc"),
      limit(50),
    ))
    : undefined;
  return {
    activities: feedSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as HouseholdActivity),
    updatesSinceLastVisit: (updatesSinceLastVisit?.docs ?? []).map((item) => ({ id: item.id, ...item.data() }) as HouseholdActivity),
    hasPreviousVisit: Boolean(lastSeenAt),
  };
}

export async function markHouseholdActivitySeen(database: Firestore, householdId: string, uid: string) {
  await updateDoc(doc(database, "users", uid, "households", householdId), {
    lastSeenAt: serverTimestamp(),
  });
}
