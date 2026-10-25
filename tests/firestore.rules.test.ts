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
  increment,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  Timestamp,
  type Firestore,
} from "firebase/firestore";
import { getHouseholdsForUser } from "../src/lib/household-memberships";
import { acceptHouseholdInvitation, createHouseholdInvitation } from "../src/lib/invitations";
import { copyPreviousMonthBudgets, deleteAccount, deleteTransaction, saveTransaction } from "../src/lib/finance";
import { DEFAULT_CATEGORIES, type FinancialTransaction, type MonthlyBudget } from "../src/lib/types";

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

  for (const currency of ["INR", "SAR", "KWD"]) {
    const id = `currency-${currency.toLowerCase()}`;
    const batch = writeBatch(database);
    batch.set(doc(database, "households", id), householdDocument("alice", "Valid Name", currency));
    batch.set(doc(database, "households", id, "members", "alice"), memberDocument("alice", "owner"));
    batch.set(doc(database, "users", "alice", "households", id), indexDocument(id));
    await assertSucceeds(batch.commit());
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
    const uid = database === alice ? "alice" : "bob";
    await assertSucceeds(getDocs(collection(database, "households", householdId, "categories")));
    await assertSucceeds(setDoc(doc(database, "households", householdId, "recurringPayments", `${uid}-one-time`), {
      name: "One-time bill", amountMinor: 2500, dueDay: 18, frequency: "once", monthKey: "2026-10",
      createdBy: uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
    await assertFails(setDoc(doc(database, "households", householdId, "recurringPayments", `${uid}-missing-month`), {
      name: "Invalid one-time bill", amountMinor: 2500, dueDay: 18, frequency: "once",
      createdBy: uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
    await assertFails(setDoc(doc(database, "households", householdId, "recurringPayments", `${uid}-invalid-month`), {
      name: "Invalid month bill", amountMinor: 2500, dueDay: 18, frequency: "once", monthKey: "2026-13",
      createdBy: uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
    await assertSucceeds(setDoc(doc(database, "households", householdId, "budgets", `${database === alice ? "alice" : "bob"}-budget`), {
      month: "2026-10", category: "Groceries", limitMinor: 50000,
      createdBy: database === alice ? "alice" : "bob", createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
    await assertSucceeds(setDoc(doc(database, "households", householdId, "budgets", `${uid}-yearly-budget`), {
      month: "2026-01", period: "yearly", category: "Groceries", limitMinor: 600000,
      createdBy: uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
    await assertFails(setDoc(doc(database, "households", householdId, "budgets", `${uid}-invalid-period-budget`), {
      month: "2026-01", period: "weekly", category: "Groceries", limitMinor: 600000,
      createdBy: uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
    await assertFails(setDoc(doc(database, "households", householdId, "budgets", `${uid}-invalid-year-month-budget`), {
      month: "2026-10", period: "yearly", category: "Groceries", limitMinor: 600000,
      createdBy: uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
    await assertFails(setDoc(doc(database, "households", householdId, "budgets", `${uid}-paycheck-budget`), {
      month: "2026-10", category: "Paycheck", limitMinor: 50000,
      createdBy: uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
    await assertSucceeds(setDoc(doc(database, "households", householdId, "transactions", `${uid}-paycheck`), {
      type: "credit", purpose: "income", transferDestination: null, category: "Paycheck", description: "Monthly pay", amountMinor: 500000,
      date: "2026-10-01", accountId: null, ownerUid: uid, createdBy: uid,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
    for (const [accountId, kind] of [[`${uid}-cash`, "savings"], [`${uid}-brokerage`, "brokerage"], [`${uid}-retirement`, "retirement"]] as const) {
      await assertSucceeds(setDoc(doc(database, "households", householdId, "accounts", accountId), {
        name: accountId, kind, ownerUid: uid, balanceMinor: 500000, currency: "USD", archived: false,
        createdBy: uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      }));
    }
    await assertFails(setDoc(doc(database, "households", householdId, "transactions", `${uid}-missing-source-transfer`), {
      type: "transfer", purpose: "investment", transferDestination: "brokerage", category: "Savings and expenses", description: "Missing source account", amountMinor: 1,
      date: "2026-10-02", accountId: `${uid}-brokerage`, sourceAccountId: null, ledgerApplied: true, ownerUid: uid, createdBy: uid,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
    await assertSucceeds(saveTransaction(database as unknown as Firestore, householdId, uid, {
      type: "transfer", purpose: "investment", transferDestination: "brokerage", category: "Savings and expenses", description: "Move to brokerage", amountMinor: 25000,
      date: "2026-10-02", accountId: `${uid}-brokerage`, sourceAccountId: `${uid}-cash`, ownerUid: uid,
    }));
    await assertSucceeds(saveTransaction(database as unknown as Firestore, householdId, uid, {
      type: "transfer", purpose: "investment", transferDestination: "cash", category: "Savings and expenses", description: "Savings contribution", amountMinor: 15000,
      date: "2026-10-02", accountId: `${uid}-cash`, sourceAccountId: `${uid}-brokerage`, ownerUid: uid,
    }));
    await assertSucceeds(saveTransaction(database as unknown as Firestore, householdId, uid, {
      type: "transfer", purpose: "investment", transferDestination: "retirement", category: "Savings and expenses", description: "Retirement contribution", amountMinor: 15000,
      date: "2026-10-02", accountId: `${uid}-retirement`, sourceAccountId: `${uid}-cash`, ownerUid: uid,
    }));
    await assertFails(setDoc(doc(database, "households", householdId, "transactions", `${uid}-custom-category`), {
      type: "debit", purpose: "ordinary", transferDestination: null, category: "Unlisted category", description: "Should be rejected", amountMinor: 1000,
      date: "2026-10-03", accountId: null, ownerUid: uid, createdBy: uid,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
    const goalReference = doc(database, "households", householdId, "goals", `${uid}-goal`);
    await assertSucceeds(setDoc(goalReference, {
      name: "Emergency fund", targetMinor: 1000000, currentMinor: 100000, deadline: "2027-12-31", ownerUid: uid,
      createdBy: uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
    await assertSucceeds(updateDoc(goalReference, {
      currentMinor: increment(50000),
      updatedAt: serverTimestamp(),
    }));
  }
  await assertFails(getDoc(doc(mallory, "households", householdId, "categories", "cat-groceries")));
  await assertFails(setDoc(doc(mallory, "households", householdId, "assets", "stolen"), {
    name: "stolen", amountMinor: 1, ownerUid: "mallory", createdBy: "mallory", createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  }));
  await assertFails(getDoc(doc(mallory, "households", householdId, "transactions", "alice-paycheck")));
  await assertFails(getDoc(doc(mallory, "households", householdId, "goals", "alice-goal")));
  await assertSucceeds(getDocs(collection(alice, "households", householdId, "recurringPayments")));
  await assertFails(getDoc(doc(alice, "households", householdId, "recurringPayments", "bill", "paymentOccurrences", "october")));
});

test("household activity is immutable and last-seen timestamps are private to each member", async () => {
  await createHouseholdAtomically("alice");
  await addMemberAtomically("alice", "bob");
  const alice = testEnv.authenticatedContext("alice").firestore();
  const bob = testEnv.authenticatedContext("bob").firestore();
  const mallory = testEnv.authenticatedContext("mallory").firestore();
  const activity = doc(alice, "households", householdId, "activity", "event-1");

  await assertSucceeds(setDoc(activity, {
    actorUid: "alice", actorName: "Alice", summary: "A budget was saved.", createdAt: serverTimestamp(),
  }));
  await assertSucceeds(getDoc(doc(bob, "households", householdId, "activity", "event-1")));
  await assertFails(updateDoc(activity, { summary: "Changed" }));
  await assertFails(setDoc(doc(mallory, "households", householdId, "activity", "event-2"), {
    actorUid: "mallory", actorName: "Mallory", summary: "Unauthorized update", createdAt: serverTimestamp(),
  }));
  await assertSucceeds(updateDoc(doc(bob, "users", "bob", "households", householdId), { lastSeenAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(alice, "users", "bob", "households", householdId), { lastSeenAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(alice, "users", "alice", "households", householdId), { createdAt: serverTimestamp() }));
});

test("investment transfers atomically move balances and reverse correctly on edit and delete", async () => {
  const database = await createHouseholdAtomically("alice");
  const accounts = collection(database, "households", householdId, "accounts");
  for (const [id, kind, balanceMinor] of [
    ["cash", "savings", 10000],
    ["brokerage", "brokerage", 100],
    ["retirement", "retirement", 200],
  ] as const) {
    await assertSucceeds(setDoc(doc(accounts, id), {
      name: id, kind, ownerUid: "alice", balanceMinor, currency: "USD", archived: false,
      createdBy: "alice", createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
  }
  const transferInput = {
    type: "transfer" as const,
    purpose: "investment" as const,
    transferDestination: "brokerage" as const,
    category: "Savings and expenses",
    description: "Transfer",
    amountMinor: 2500,
    date: "2026-10-02",
    accountId: "brokerage",
    sourceAccountId: "cash",
    ownerUid: "alice",
  };
  const transactionId = await saveTransaction(database as unknown as Firestore, householdId, "alice", transferInput);
  assert.ok(transactionId);
  assert.equal((await getDoc(doc(accounts, "cash"))).data()?.balanceMinor, 7500);
  assert.equal((await getDoc(doc(accounts, "brokerage"))).data()?.balanceMinor, 2600);

  const savedTransfer = (await getDoc(doc(database, "households", householdId, "transactions", transactionId))).data();
  await saveTransaction(database as unknown as Firestore, householdId, "alice", {
    ...transferInput,
    transferDestination: "retirement",
    accountId: "retirement",
    amountMinor: 1500,
  }, { id: transactionId, ...savedTransfer } as FinancialTransaction);
  assert.equal((await getDoc(doc(accounts, "cash"))).data()?.balanceMinor, 8500);
  assert.equal((await getDoc(doc(accounts, "brokerage"))).data()?.balanceMinor, 100);
  assert.equal((await getDoc(doc(accounts, "retirement"))).data()?.balanceMinor, 1700);

  await assert.rejects(deleteAccount(database as unknown as Firestore, householdId, "retirement"), /Delete transfers linked/);
  await assert.rejects(saveTransaction(database as unknown as Firestore, householdId, "alice", {
    ...transferInput,
    amountMinor: 9000,
  }));
  await deleteTransaction(database as unknown as Firestore, householdId, transactionId);
  assert.equal((await getDoc(doc(accounts, "cash"))).data()?.balanceMinor, 10000);
  assert.equal((await getDoc(doc(accounts, "retirement"))).data()?.balanceMinor, 200);
});

test("paycheck allocations add to a selected investment account without a source account", async () => {
  const database = await createHouseholdAtomically("alice");
  const accounts = collection(database, "households", householdId, "accounts");
  await assertSucceeds(setDoc(doc(accounts, "brokerage"), {
    name: "Brokerage", kind: "brokerage", ownerUid: "alice", balanceMinor: 10000, currency: "USD", archived: false,
    createdBy: "alice", createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  }));
  const transactionId = await saveTransaction(database as unknown as Firestore, householdId, "alice", {
    type: "transfer",
    purpose: "investment",
    transferDestination: "brokerage",
    category: "Paycheck transfer",
    description: "Monthly paycheck allocation",
    amountMinor: 2500,
    date: "2026-10-02",
    accountId: "brokerage",
    sourceAccountId: null,
    ownerUid: "alice",
  });
  assert.equal((await getDoc(doc(accounts, "brokerage"))).data()?.balanceMinor, 12500);
  const saved = (await getDoc(doc(database, "households", householdId, "transactions", transactionId))).data();
  assert.equal(saved?.category, "Paycheck transfer");
  assert.equal(saved?.sourceAccountId, null);
  assert.equal(saved?.ledgerApplied, true);
  await deleteTransaction(database as unknown as Firestore, householdId, transactionId);
  assert.equal((await getDoc(doc(accounts, "brokerage"))).data()?.balanceMinor, 10000);
});

test("copying previous month budgets updates matching categories and adds missing categories", async () => {
  const database = await createHouseholdAtomically("alice");
  const budgets = collection(database, "households", householdId, "budgets");
  await assertSucceeds(setDoc(doc(budgets, "previous-groceries"), {
    month: "2026-09", category: "Groceries", limitMinor: 55000,
    createdBy: "alice", createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  }));
  await assertSucceeds(setDoc(doc(budgets, "previous-shopping"), {
    month: "2026-09", category: "Shopping", limitMinor: 25000,
    createdBy: "alice", createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  }));
  await assertSucceeds(setDoc(doc(budgets, "current-groceries"), {
    month: "2026-10", category: "Groceries", limitMinor: 40000,
    createdBy: "alice", createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  }));
  await assertSucceeds(setDoc(doc(budgets, "current-housing"), {
    month: "2026-10", category: "Housing & utilities", limitMinor: 150000,
    createdBy: "alice", createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  }));

  const existing = (await getDocs(budgets)).docs.map((item) => ({
    id: item.id,
    ...item.data(),
  }) as MonthlyBudget);
  const result = await copyPreviousMonthBudgets(
    database as unknown as Firestore,
    householdId,
    "alice",
    "2026-09",
    "2026-10",
    existing,
  );

  assert.deepEqual(result, { added: 1, updated: 1 });
  const targetBudgets = (await getDocs(budgets)).docs
    .map((item) => item.data())
    .filter((budget) => budget.month === "2026-10");
  assert.equal(targetBudgets.find((budget) => budget.category === "Groceries")?.limitMinor, 55000);
  assert.equal(targetBudgets.find((budget) => budget.category === "Shopping")?.limitMinor, 25000);
  assert.equal(targetBudgets.find((budget) => budget.category === "Housing & utilities")?.limitMinor, 150000);
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

test("regular member cannot create invitations, snapshots are immutable, and account deletion removes snapshots", async () => {
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
  await assertSucceeds(deleteAccount(alice as unknown as Firestore, householdId, "cash"));
  assert.equal((await getDoc(doc(alice, "households", householdId, "accounts", "cash"))).exists(), false);
  assert.equal((await getDoc(snapshotRef)).exists(), false);
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
