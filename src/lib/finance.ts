import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
  type Firestore,
} from "firebase/firestore";
import type {
  AccountSnapshot,
  FinanceCategory,
  FinancialAccount,
  FinancialTransaction,
  ManualValueRecord,
  MonthlyBudget,
  SavingsGoal,
} from "@/lib/types";

export type HouseholdFinanceData = {
  accounts: FinancialAccount[];
  categories: FinanceCategory[];
  transactions: FinancialTransaction[];
  budgets: MonthlyBudget[];
  goals: SavingsGoal[];
  assets: ManualValueRecord[];
  liabilities: ManualValueRecord[];
};

const path = (householdId: string, group: string) => ["households", householdId, group] as const;

async function readCollection<T extends { id: string }>(
  database: Firestore,
  householdId: string,
  group: string,
): Promise<T[]> {
  const snapshot = await getDocs(collection(database, ...path(householdId, group)));
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as T);
}

export async function loadHouseholdFinance(
  database: Firestore,
  householdId: string,
): Promise<HouseholdFinanceData> {
  const [accounts, categories, transactions, budgets, goals, assets, liabilities] = await Promise.all([
    readCollection<FinancialAccount>(database, householdId, "accounts"),
    readCollection<FinanceCategory>(database, householdId, "categories"),
    readCollection<FinancialTransaction>(database, householdId, "transactions"),
    readCollection<MonthlyBudget>(database, householdId, "budgets"),
    readCollection<SavingsGoal>(database, householdId, "goals"),
    readCollection<ManualValueRecord>(database, householdId, "assets"),
    readCollection<ManualValueRecord>(database, householdId, "liabilities"),
  ]);
  return { accounts, categories, transactions, budgets, goals, assets, liabilities };
}

function positiveMinorAmount(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative amount in cents.`);
  }
}

export function parseMoneyToMinorUnits(value: string): number {
  const trimmed = value.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    throw new Error("Enter an amount with up to two decimal places.");
  }
  const [whole, fractional = ""] = trimmed.split(".");
  const amount = Number(whole) * 100 + Number(fractional.padEnd(2, "0"));
  if (!Number.isSafeInteger(amount)) throw new Error("Amount is too large.");
  positiveMinorAmount(amount, "Amount");
  return amount;
}

export function formatMoney(minor: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
  }).format(minor / 100);
}

export function currentMonthKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function isMonthKey(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export type FinanceSummary = {
  assetsMinor: number;
  liabilitiesMinor: number;
  netWorthMinor: number;
  incomeMinor: number;
  ordinaryExpensesMinor: number;
  investmentContributionsMinor: number;
  availableToSpendMinor: number;
};

export function calculateFinanceSummary(
  data: Pick<HouseholdFinanceData, "accounts" | "assets" | "liabilities" | "transactions">,
  month: string,
): FinanceSummary {
  const assetsMinor = data.accounts
    .filter((account) => !account.archived)
    .reduce((sum, account) => sum + account.balanceMinor, 0)
    + data.assets.reduce((sum, asset) => sum + asset.amountMinor, 0);
  const liabilitiesMinor = data.liabilities.reduce((sum, item) => sum + item.amountMinor, 0);
  const monthPrefix = `${month}-`;
  const currentTransactions = data.transactions.filter((item) => item.date.startsWith(monthPrefix));
  const incomeMinor = currentTransactions
    .filter((item) => item.type === "credit" && item.purpose === "income")
    .reduce((sum, item) => sum + item.amountMinor, 0);
  const ordinaryExpensesMinor = currentTransactions
    .filter((item) => item.type === "debit" && item.purpose === "ordinary")
    .reduce((sum, item) => sum + item.amountMinor, 0);
  const investmentContributionsMinor = currentTransactions
    .filter((item) => item.type === "debit" && item.purpose === "investment")
    .reduce((sum, item) => sum + item.amountMinor, 0);

  return {
    assetsMinor,
    liabilitiesMinor,
    netWorthMinor: assetsMinor - liabilitiesMinor,
    incomeMinor,
    ordinaryExpensesMinor,
    investmentContributionsMinor,
    availableToSpendMinor: incomeMinor - ordinaryExpensesMinor - investmentContributionsMinor,
  };
}

type AccountInput = Pick<FinancialAccount, "name" | "kind" | "ownerUid" | "balanceMinor">;

export async function saveAccount(
  database: Firestore,
  householdId: string,
  actorUid: string,
  currency: FinancialAccount["currency"],
  input: AccountInput,
  existing?: FinancialAccount,
) {
  positiveMinorAmount(input.balanceMinor, "Balance");
  const reference = existing
    ? doc(database, ...path(householdId, "accounts"), existing.id)
    : doc(collection(database, ...path(householdId, "accounts")));
  const values = {
    ...input,
    currency,
    archived: existing?.archived ?? false,
    createdBy: existing?.createdBy ?? actorUid,
    createdAt: existing?.createdAt ?? serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  await setDoc(reference, values);
  return reference.id;
}

export async function archiveAccount(database: Firestore, householdId: string, accountId: string) {
  await updateDoc(doc(database, ...path(householdId, "accounts"), accountId), {
    archived: true,
    updatedAt: serverTimestamp(),
  });
}

export async function addAccountSnapshot(
  database: Firestore,
  householdId: string,
  accountId: string,
  actorUid: string,
  month: string,
  amountMinor: number,
) {
  if (!isMonthKey(month)) throw new Error("Choose a valid snapshot month.");
  positiveMinorAmount(amountMinor, "Snapshot amount");
  const reference = doc(database, ...path(householdId, "accounts"), accountId, "snapshots", month);
  await setDoc(reference, { month, amountMinor, recordedBy: actorUid, createdAt: serverTimestamp() });
}

type TransactionInput = Pick<FinancialTransaction,
  "type" | "purpose" | "category" | "description" | "amountMinor" | "date" | "accountId" | "ownerUid"
>;

export async function saveTransaction(
  database: Firestore,
  householdId: string,
  actorUid: string,
  input: TransactionInput,
  existing?: FinancialTransaction,
) {
  positiveMinorAmount(input.amountMinor, "Transaction amount");
  if ((input.type === "credit") !== (input.purpose === "income")) {
    throw new Error("Credits must be income; debits must be ordinary expenses or investments.");
  }
  if (!isCalendarDate(input.date)) {
    throw new Error("Choose a valid transaction date.");
  }
  if (input.amountMinor <= 0) throw new Error("Transaction amount must be greater than zero.");
  const reference = existing
    ? doc(database, ...path(householdId, "transactions"), existing.id)
    : doc(collection(database, ...path(householdId, "transactions")));
  await setDoc(reference, {
    ...input,
    createdBy: existing?.createdBy ?? actorUid,
    createdAt: existing?.createdAt ?? serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return reference.id;
}

export async function deleteTransaction(database: Firestore, householdId: string, id: string) {
  await deleteDoc(doc(database, ...path(householdId, "transactions"), id));
}

export async function saveCategory(
  database: Firestore,
  householdId: string,
  actorUid: string,
  name: string,
  kind: FinanceCategory["kind"],
) {
  const categoryName = name.trim();
  if (!categoryName || categoryName.length > 60) throw new Error("Category names must be 1–60 characters.");
  const reference = await addDoc(collection(database, ...path(householdId, "categories")), {
    name: categoryName,
    kind,
    isDefault: false,
    createdBy: actorUid,
    createdAt: serverTimestamp(),
  });
  return reference.id;
}

type BudgetInput = Pick<MonthlyBudget, "month" | "category" | "limitMinor">;
export async function saveBudget(
  database: Firestore,
  householdId: string,
  actorUid: string,
  input: BudgetInput,
  existing?: MonthlyBudget,
) {
  positiveMinorAmount(input.limitMinor, "Budget");
  if (!isMonthKey(input.month)) throw new Error("Choose a valid budget month.");
  const reference = existing
    ? doc(database, ...path(householdId, "budgets"), existing.id)
    : doc(collection(database, ...path(householdId, "budgets")));
  await setDoc(reference, {
    ...input,
    createdBy: existing?.createdBy ?? actorUid,
    createdAt: existing?.createdAt ?? serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return reference.id;
}

type GoalInput = Pick<SavingsGoal, "name" | "targetMinor" | "currentMinor" | "deadline" | "ownerUid">;
export async function saveGoal(
  database: Firestore,
  householdId: string,
  actorUid: string,
  input: GoalInput,
  existing?: SavingsGoal,
) {
  positiveMinorAmount(input.targetMinor, "Goal target");
  positiveMinorAmount(input.currentMinor, "Goal progress");
  const goalName = input.name.trim();
  if (!goalName || goalName.length > 80) throw new Error("Goal names must be 1–80 characters.");
  const reference = existing
    ? doc(database, ...path(householdId, "goals"), existing.id)
    : doc(collection(database, ...path(householdId, "goals")));
  await setDoc(reference, {
    ...input,
    name: goalName,
    createdBy: existing?.createdBy ?? actorUid,
    createdAt: existing?.createdAt ?? serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return reference.id;
}

type ValueInput = Pick<ManualValueRecord, "name" | "amountMinor" | "ownerUid">;
export async function saveManualValue(
  database: Firestore,
  householdId: string,
  actorUid: string,
  group: "assets" | "liabilities",
  input: ValueInput,
  existing?: ManualValueRecord,
) {
  positiveMinorAmount(input.amountMinor, "Value");
  const name = input.name.trim();
  if (!name || name.length > 80) throw new Error("Names must be 1–80 characters.");
  const reference = existing
    ? doc(database, ...path(householdId, group), existing.id)
    : doc(collection(database, ...path(householdId, group)));
  await setDoc(reference, {
    ...input,
    name,
    createdBy: existing?.createdBy ?? actorUid,
    createdAt: existing?.createdAt ?? serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return reference.id;
}

export async function deleteRecord(
  database: Firestore,
  householdId: string,
  group: "budgets" | "goals" | "assets" | "liabilities" | "categories",
  id: string,
) {
  await deleteDoc(doc(database, ...path(householdId, group), id));
}

export function budgetProgress(
  budget: MonthlyBudget,
  transactions: FinancialTransaction[],
) {
  const spentMinor = transactions
    .filter((item) => item.date.startsWith(`${budget.month}-`)
      && item.type === "debit"
      && item.purpose === "ordinary"
      && item.category === budget.category)
    .reduce((sum, item) => sum + item.amountMinor, 0);
  return {
    spentMinor,
    remainingMinor: budget.limitMinor - spentMinor,
    percent: budget.limitMinor === 0 ? (spentMinor > 0 ? 100 : 0) : Math.round((spentMinor / budget.limitMinor) * 100),
    overspent: spentMinor > budget.limitMinor,
  };
}

export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export async function getAccountSnapshots(
  database: Firestore,
  householdId: string,
  accountId: string,
): Promise<AccountSnapshot[]> {
  const snapshot = await getDocs(collection(database, ...path(householdId, "accounts"), accountId, "snapshots"));
  return snapshot.docs
    .map((item) => ({ id: item.id, ...item.data() }) as AccountSnapshot)
    .sort((a, b) => b.month.localeCompare(a.month));
}
