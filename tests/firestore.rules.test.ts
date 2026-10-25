import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, beforeEach, test } from "node:test";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  Timestamp,
  type Firestore,
} from "firebase/firestore";
import { getHouseholdsForUser } from "../src/lib/household-memberships";
import { acceptHouseholdInvitation, createHouseholdInvitation } from "../src/lib/invitations";
import { DEFAULT_CATEGORIES } from "../src/lib/types";

const projectId = "demo-household-hq";
const householdId = "family-home";
let testEnv: RulesTestEnvironment;

function householdDocument(ownerUid: string, name = "Family Home", currency = "USD") {
  return {
    name,
    currency,
    ownerUid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

function memberDocument(uid: string, role: "owner" | "member") {
  return {
    uid,
    email: `${uid}@example.test`,
    displayName: uid,
    role,
    status: "active",
    joinedAt: serverTimestamp(),
    invitationId: null,
  };
}

function indexDocument(id: string) {
  return { householdId: id, createdAt: serverTimestamp() };
}

async function createHouseholdAtomically(
  uid: string,
  id = householdId,
  name = "Family Home",
  currency = "USD",
) {
  const database = testEnv.authenticatedContext(uid).firestore();
  const batch = writeBatch(database);
  batch.set(doc(database, "households", id), householdDocument(uid, name, currency));
  batch.set(doc(database, "households", id, "members", uid), memberDocument(uid, "owner"));
  batch.set(doc(database, "users", uid, "households", id), indexDocument(id));
  await batch.commit();
  const categoryBatch = writeBatch(database);
  for (const category of DEFAULT_CATEGORIES) {
    categoryBatch.set(doc(database, "households", id, "categories", category.id), {
      name: category.name, kind: category.kind, isDefault: true, createdBy: uid, createdAt: serverTimestamp(),
    });
  }
  await categoryBatch.commit();
  return database;
}

async function addMemberAtomically(ownerUid: string, memberUid: string, id = householdId) {
  void ownerUid;
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const database = context.firestore();
    const batch = writeBatch(database);
    batch.set(doc(database, "households", id, "members", memberUid), { ...memberDocument(memberUid, "member"), invitationId: "fixture-invitation" });
    batch.set(doc(database, "users", memberUid, "households", id), indexDocument(id));
    await batch.commit();
  });
}

before(async () => {
  const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: { rules },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

after(async () => {
  await testEnv.cleanup();
});

test("creator atomically creates household, owner membership, and private index", async () => {
  const database = testEnv.authenticatedContext("alice").firestore();
  const batch = writeBatch(database);
  batch.set(doc(database, "households", householdId), householdDocument("alice"));
  batch.set(doc(database, "households", householdId, "members", "alice"), memberDocument("alice", "owner"));
  batch.set(doc(database, "users", "alice", "households", householdId), indexDocument(householdId));

  await assertSucceeds(batch.commit());
  const categoryBatch = writeBatch(database);
  for (const category of DEFAULT_CATEGORIES) categoryBatch.set(doc(database, "households", householdId, "categories", category.id), { name: category.name, kind: category.kind, isDefault: true, createdBy: "alice", createdAt: serverTimestamp() });
  await assertSucceeds(categoryBatch.commit());
  await assertSucceeds(getDoc(doc(database, "households", householdId)));
  await assertSucceeds(getDoc(doc(database, "households", householdId, "members", "alice")));
  await assertSucceeds(getDoc(doc(database, "users", "alice", "households", householdId)));
  const categories = await assertSucceeds(getDocs(collection(database, "households", householdId, "categories")));
  assert.equal(categories.size, DEFAULT_CATEGORIES.length);
});

test("household, membership, and index cannot be created separately", async () => {
  const database = testEnv.authenticatedContext("alice").firestore();
  await createHouseholdAtomically("alice", "existing-home");

  await assertFails(setDoc(doc(database, "households", "new-home"), householdDocument("alice")));
  await assertFails(setDoc(
    doc(testEnv.authenticatedContext("mallory").firestore(), "households", "existing-home", "members", "mallory"),
    memberDocument("mallory", "owner"),
  ));
  await assertFails(setDoc(
    doc(database, "users", "alice", "households", "new-home"),
    indexDocument("new-home"),
  ));
});

test("rejects blank names, unsupported currencies, and incomplete atomic batches", async () => {
  const database = testEnv.authenticatedContext("alice").firestore();
  const invalidCases = [
    { id: "blank", name: "   ", currency: "USD" },
    { id: "currency", name: "Valid Name", currency: "XYZ" },
  ];

  for (const item of invalidCases) {
    const batch = writeBatch(database);
    batch.set(doc(database, "households", item.id), householdDocument("alice", item.name, item.currency));
    batch.set(doc(database, "households", item.id, "members", "alice"), memberDocument("alice", "owner"));
    batch.set(doc(database, "users", "alice", "households", item.id), indexDocument(item.id));
    await assertFails(batch.commit());
  }

  const incompleteBatch = writeBatch(database);
  incompleteBatch.set(doc(database, "households", "missing-index"), householdDocument("alice"));
  incompleteBatch.set(doc(database, "households", "missing-index", "members", "alice"), memberDocument("alice", "owner"));
  await assertFails(incompleteBatch.commit());
});

test("two authorized members can read the household and use the actual discovery query", async () => {
  await createHouseholdAtomically("alice");
  await addMemberAtomically("alice", "bob");
  const alice = testEnv.authenticatedContext("alice").firestore();
  const bob = testEnv.authenticatedContext("bob").firestore();

  await assertSucceeds(getDoc(doc(alice, "households", householdId)));
  await assertSucceeds(getDoc(doc(bob, "households", householdId)));

  const aliceHouseholds = await assertSucceeds(getHouseholdsForUser(alice as unknown as Firestore, "alice"));
  const bobHouseholds = await assertSucceeds(getHouseholdsForUser(bob as unknown as Firestore, "bob"));
  assert.deepEqual(aliceHouseholds.map((item) => item.householdId), [householdId]);
  assert.deepEqual(bobHouseholds.map((item) => item.householdId), [householdId]);
});

test("supports multiple memberships without returning another user's index", async () => {
  await createHouseholdAtomically("alice", "home-one", "Home One");
  await createHouseholdAtomically("alice", "home-two", "Home Two", "CAD");
  const alice = testEnv.authenticatedContext("alice").firestore();
  const bob = testEnv.authenticatedContext("bob").firestore();

  const memberships = await assertSucceeds(getHouseholdsForUser(alice as unknown as Firestore, "alice"));
  assert.deepEqual(new Set(memberships.map((item) => item.householdId)), new Set(["home-one", "home-two"]));
  await assertFails(getDocs(collection(bob, "users", "alice", "households")));
});

test("unrelated users cannot read or modify a household or join themselves", async () => {
  await createHouseholdAtomically("alice");
  const stranger = testEnv.authenticatedContext("mallory").firestore();

  await assertFails(getDoc(doc(stranger, "households", householdId)));
  await assertFails(setDoc(doc(stranger, "households", householdId), householdDocument("mallory")));

  const joinBatch = writeBatch(stranger);
  joinBatch.set(doc(stranger, "households", householdId, "members", "mallory"), memberDocument("mallory", "member"));
  joinBatch.set(doc(stranger, "users", "mallory", "households", householdId), indexDocument(householdId));
  await assertFails(joinBatch.commit());

  await assertFails(updateDoc(doc(stranger, "households", householdId), { name: "Taken over" }));
});

test("regular members cannot promote themselves or another member", async () => {
  await createHouseholdAtomically("alice");
  await addMemberAtomically("alice", "bob");
  const bob = testEnv.authenticatedContext("bob").firestore();

  await assertFails(updateDoc(
    doc(bob, "households", householdId, "members", "bob"),
    { role: "owner" },
  ));
  await assertFails(updateDoc(
    doc(bob, "households", householdId, "members", "alice"),
    { role: "member" },
  ));
  await assertFails(setDoc(
    doc(bob, "households", householdId, "members", "mallory"),
    memberDocument("mallory", "owner"),
  ));
});

test("owner can transfer ownership only by atomically updating the household and both roles", async () => {
  await createHouseholdAtomically("alice");
  await addMemberAtomically("alice", "bob");
  const alice = testEnv.authenticatedContext("alice").firestore();
  const bob = testEnv.authenticatedContext("bob").firestore();

  const incomplete = writeBatch(alice);
  incomplete.update(doc(alice, "households", householdId), {
    ownerUid: "bob", updatedAt: serverTimestamp(),
  });
  await assertFails(incomplete.commit());

  const transfer = writeBatch(alice);
  transfer.update(doc(alice, "households", householdId), {
    ownerUid: "bob", updatedAt: serverTimestamp(),
  });
  transfer.update(doc(alice, "households", householdId, "members", "alice"), { role: "member" });
  transfer.update(doc(alice, "households", householdId, "members", "bob"), { role: "owner" });
  await assertSucceeds(transfer.commit());

  assert.equal((await assertSucceeds(getDoc(doc(bob, "households", householdId)))).data()?.ownerUid, "bob");
  assert.equal((await assertSucceeds(getDoc(doc(bob, "households", householdId, "members", "bob")))).data()?.role, "owner");
  assert.equal((await assertSucceeds(getDoc(doc(alice, "households", householdId, "members", "alice")))).data()?.role, "member");

  const formerOwner = writeBatch(alice);
  formerOwner.update(doc(alice, "households", householdId, "members", "alice"), { role: "owner" });
  await assertFails(formerOwner.commit());
});

test("owner can promote multiple members and every co-owner retains owner access", async () => {
  await createHouseholdAtomically("alice");
  await addMemberAtomically("alice", "bob");
  await addMemberAtomically("alice", "charlie");
  const alice = testEnv.authenticatedContext("alice").firestore();
  const bob = testEnv.authenticatedContext("bob").firestore();

  await assertSucceeds(updateDoc(
    doc(alice, "households", householdId, "members", "bob"),
    { role: "owner" },
  ));
  await assertSucceeds(updateDoc(
    doc(alice, "households", householdId, "members", "charlie"),
    { role: "owner" },
  ));

  assert.equal((await assertSucceeds(getDoc(doc(alice, "households", householdId)))).data()?.ownerUid, "alice");
  assert.equal((await assertSucceeds(getDoc(doc(bob, "households", householdId, "members", "bob")))).data()?.role, "owner");
  await assertSucceeds(createHouseholdInvitation(bob as unknown as Firestore, householdId, "bob"));
});

test("authorized members can use financial records while unrelated users and unknown paths are denied", async () => {
  await createHouseholdAtomically("alice");
  await addMemberAtomically("alice", "bob");
  const alice = testEnv.authenticatedContext("alice").firestore();
  const bob = testEnv.authenticatedContext("bob").firestore();
  const mallory = testEnv.authenticatedContext("mallory").firestore();

  for (const database of [alice, bob]) {
    await assertSucceeds(getDocs(collection(database, "households", householdId, "categories")));
    await assertSucceeds(setDoc(doc(database, "households", householdId, "budgets", `${database === alice ? "alice" : "bob"}-budget`), {
      month: "2026-10", category: "Groceries", limitMinor: 50000,
      createdBy: database === alice ? "alice" : "bob", createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
    const uid = database === alice ? "alice" : "bob";
    await assertSucceeds(setDoc(doc(database, "households", householdId, "transactions", `${uid}-paycheck`), {
      type: "credit", purpose: "income", category: "Paycheck", description: "Monthly pay", amountMinor: 500000,
      date: "2026-10-01", accountId: null, ownerUid: uid, createdBy: uid,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
    await assertSucceeds(setDoc(doc(database, "households", householdId, "goals", `${uid}-goal`), {
      name: "Emergency fund", targetMinor: 1000000, currentMinor: 100000, deadline: "2027-12-31", ownerUid: uid,
      createdBy: uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
  }
  await assertFails(getDoc(doc(mallory, "households", householdId, "categories", "cat-groceries")));
  await assertFails(setDoc(doc(mallory, "households", householdId, "assets", "stolen"), {
    name: "stolen", amountMinor: 1, ownerUid: "mallory", createdBy: "mallory", createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  }));
  await assertFails(getDoc(doc(mallory, "households", householdId, "transactions", "alice-paycheck")));
  await assertFails(getDoc(doc(mallory, "households", householdId, "goals", "alice-goal")));
  await assertFails(getDocs(collection(alice, "households", householdId, "recurringPayments")));
  await assertFails(getDoc(doc(alice, "households", householdId, "recurringPayments", "bill", "paymentOccurrences", "october")));
});

test("strong invitation code lets an unverified signed-in user join once and discovers household", async () => {
  await createHouseholdAtomically("alice");
  const alice = testEnv.authenticatedContext("alice").firestore();
  const bob = testEnv.authenticatedContext("bob", { email: "bob@example.test", email_verified: false, name: "Bob" }).firestore();
  const code = await assertSucceeds(createHouseholdInvitation(alice as unknown as Firestore, householdId, "alice"));
  assert.match(code, /^[A-Za-z0-9_-]{22}$/);
  await assertFails(getDocs(collection(bob, "householdInvitationCodes")));

  const bobUser = { uid: "bob", email: "bob@example.test", displayName: "Bob" };
  assert.equal(await assertSucceeds(acceptHouseholdInvitation(bob as unknown as Firestore, code, bobUser)), householdId);
  assert.equal(await assertSucceeds(acceptHouseholdInvitation(bob as unknown as Firestore, code, bobUser)), householdId);
  const memberships = await assertSucceeds(getHouseholdsForUser(bob as unknown as Firestore, "bob"));
  assert.deepEqual(memberships.map((item) => item.householdId), [householdId]);
  const charlie = testEnv.authenticatedContext("charlie").firestore();
  await assert.rejects(
    acceptHouseholdInvitation(charlie as unknown as Firestore, code, { uid: "charlie", email: null, displayName: null }),
    /already been used/,
  );
});

test("regular member cannot create invitations and account snapshots are immutable", async () => {
  await createHouseholdAtomically("alice");
  await addMemberAtomically("alice", "bob");
  const alice = testEnv.authenticatedContext("alice").firestore();
  const bob = testEnv.authenticatedContext("bob").firestore();
  await assertFails(createHouseholdInvitation(bob as unknown as Firestore, householdId, "bob"));
  await assertSucceeds(setDoc(doc(alice, "households", householdId, "accounts", "cash"), {
    name: "Savings", kind: "savings", ownerUid: "alice", balanceMinor: 100000, currency: "USD", archived: false,
    createdBy: "alice", createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  }));
  const snapshotRef = doc(alice, "households", householdId, "accounts", "cash", "snapshots", "2026-10");
  await assertSucceeds(setDoc(snapshotRef, { month: "2026-10", amountMinor: 90000, recordedBy: "alice", createdAt: serverTimestamp() }));
  await assertFails(setDoc(snapshotRef, { month: "2026-10", amountMinor: 80000, recordedBy: "alice", createdAt: serverTimestamp() }));
});

test("expired invitation cannot be accepted by bypassing the client service", async () => {
  await createHouseholdAtomically("alice");
  const invitationCode = "A".repeat(22);
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "householdInvitationCodes", "expired-invitation-doc"), {
      code: invitationCode,
      householdId,
      createdBy: "alice",
      createdAt: Timestamp.fromMillis(Date.now() - 10 * 24 * 60 * 60 * 1000),
      expiresAt: Timestamp.fromMillis(Date.now() - 1000),
      status: "pending",
      acceptedBy: null,
      acceptedAt: null,
    });
  });
  const charlie = testEnv.authenticatedContext("charlie").firestore();
  const batch = writeBatch(charlie);
  batch.update(doc(charlie, "householdInvitationCodes", "expired-invitation-doc"), {
    status: "accepted", acceptedBy: "charlie", acceptedAt: serverTimestamp(),
  });
  batch.set(doc(charlie, "households", householdId, "members", "charlie"), {
    ...memberDocument("charlie", "member"), invitationId: invitationCode,
  });
  batch.set(doc(charlie, "users", "charlie", "households", householdId), indexDocument(householdId));
  await assertFails(batch.commit());
});

test("unauthenticated users cannot query household discovery", async () => {
  const anonymous = testEnv.unauthenticatedContext().firestore();
  await assertFails(getHouseholdsForUser(anonymous as unknown as Firestore, "alice"));
});

test("authenticated user with no household index succeeds with an empty result", async () => {
  const database = testEnv.authenticatedContext("new-user").firestore();

  const households = await assertSucceeds(
    getHouseholdsForUser(database as unknown as Firestore, "new-user"),
  );

  assert.deepEqual(households, []);
});
