import {
  addDoc,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDocs,
  increment,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Firestore,
} from "firebase/firestore";
import type {
  AccountSnapshot,
  FinanceCategory,
  FinancialAccount,
  FinancialTransaction,
  ManualValueRecord,
  MonthlyBudget,
  RecurringPayment,
  SavingsGoal,
} from "@/lib/types";

export const TRANSACTION_CATEGORIES = [
  "Paycheck",
  "Paycheck transfer",
  "Groceries",
  "Housing & utilities",
  "Shopping",
  "Entertainment",
  "Eatout",
  "Transportation",
  "Travel",
  "Savings and expenses",
  "Health and fitness",
  "India Transfer",
  "MISC",
] as const;

export const SAVINGS_CATEGORY = "Savings and expenses";
export const BUDGET_CATEGORIES = TRANSACTION_CATEGORIES.filter(
  (category) => category !== "Paycheck" && category !== "Paycheck transfer" && category !== SAVINGS_CATEGORY,
);

export type HouseholdFinanceData = {
  accounts: FinancialAccount[];
  categories: FinanceCategory[];
  transactions: FinancialTransaction[];
  budgets: MonthlyBudget[];
  goals: SavingsGoal[];
  assets: ManualValueRecord[];
  liabilities: ManualValueRecord[];
  recurringPayments: RecurringPayment[];
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
  const [accounts, categories, transactions, budgets, goals, assets, liabilities, recurringPayments] = await Promise.all([
    readCollection<FinancialAccount>(database, householdId, "accounts"),
    readCollection<FinanceCategory>(database, householdId, "categories"),
    readCollection<FinancialTransaction>(database, householdId, "transactions"),
    readCollection<MonthlyBudget>(database, householdId, "budgets"),
    readCollection<SavingsGoal>(database, householdId, "goals"),
    readCollection<ManualValueRecord>(database, householdId, "assets"),
    readCollection<ManualValueRecord>(database, householdId, "liabilities"),
    readCollection<RecurringPayment>(database, householdId, "recurringPayments"),
  ]);
  return { accounts, categories, transactions, budgets, goals, assets, liabilities, recurringPayments };
}

type RecurringPaymentInput = Pick<RecurringPayment, "name" | "amountMinor" | "dueDay" | "frequency" | "monthKey" | "startDate" | "category">;

export async function saveRecurringPayment(database: Firestore, householdId: string, actorUid: string, input: RecurringPaymentInput) {
  const name = input.name.trim();
  if (!name || name.length > 80) throw new Error("Payment names must be 1–80 characters.");
  if (!Number.isInteger(input.dueDay) || input.dueDay < 1 || input.dueDay > 31) throw new Error("Choose a due day from 1 to 31.");
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor < 1) throw new Error("Payment amount must be greater than zero.");
  const frequency = input.frequency ?? "monthly";
  if (!["monthly", "biweekly", "every6months", "once"].includes(frequency)) throw new Error("Choose a supported payment frequency.");
  if (frequency === "once" && (!input.monthKey || !isMonthKey(input.monthKey))) {
    throw new Error("Choose the month for this one-time payment.");
  }
  if ((frequency === "biweekly" || frequency === "every6months") && (!input.startDate || !isCalendarDate(input.startDate))) {
    throw new Error("Choose a valid first due date for this recurring payment.");
  }
  if (input.startDate && !isCalendarDate(input.startDate)) throw new Error("Choose a valid first due date.");
  const category = input.category ?? "Groceries";
  if (!(BUDGET_CATEGORIES as readonly string[]).includes(category)) throw new Error("Choose a supported expense category for this bill.");
  const reference = doc(collection(database, ...path(householdId, "recurringPayments")));
  await setDoc(reference, {
    name,
    amountMinor: input.amountMinor,
    dueDay: input.dueDay,
    category,
    frequency,
    ...(frequency === "once" ? { monthKey: input.monthKey } : {}),
    ...(input.startDate ? { startDate: input.startDate } : {}),
    paidDates: [],
    createdBy: actorUid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return reference.id;
}

/** Marks one scheduled occurrence paid and records its expense atomically. */
export async function markRecurringPaymentPaid(
  database: Firestore,
  householdId: string,
  actorUid: string,
  paymentId: string,
  dueDate: string,
) {
  if (!isCalendarDate(dueDate)) throw new Error("The bill due date is invalid.");
  const paymentReference = doc(database, ...path(householdId, "recurringPayments"), paymentId);
  const transactionId = `bill-${paymentId}-${dueDate}`;
  const transactionReference = doc(database, ...path(householdId, "transactions"), transactionId);
  return runTransaction(database, async (databaseTransaction) => {
    const [paymentSnapshot, expenseSnapshot] = await Promise.all([
      databaseTransaction.get(paymentReference),
      databaseTransaction.get(transactionReference),
    ]);
    if (!paymentSnapshot.exists()) throw new Error("This bill no longer exists.");
    const payment = paymentSnapshot.data() as RecurringPayment;
    if (payment.paidDates?.includes(dueDate)) return false;
    if (expenseSnapshot.exists()) throw new Error("An expense already exists for this bill date; it was not duplicated.");
    const category = payment.category ?? "Groceries";
    if (!(BUDGET_CATEGORIES as readonly string[]).includes(category)) throw new Error("This bill has an unsupported expense category.");

    databaseTransaction.update(paymentReference, {
      paidDates: arrayUnion(dueDate),
      updatedAt: serverTimestamp(),
    });
    databaseTransaction.set(transactionReference, {
      type: "debit",
      purpose: "ordinary",
      transferDestination: null,
      category,
      description: payment.name,
      amountMinor: payment.amountMinor,
      date: dueDate,
      accountId: null,
      sourceAccountId: null,
      ledgerApplied: false,
      ownerUid: actorUid,
      createdBy: actorUid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return true;
  });
}

export async function deleteRecurringPayment(database: Firestore, householdId: string, paymentId: string) {
  await deleteDoc(doc(database, ...path(householdId, "recurringPayments"), paymentId));
}

function positiveMinorAmount(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative amount in cents.`);
  }
}

function currencyMinorUnitScale(currency: string) {
  const fractionDigits = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
  }).resolvedOptions().maximumFractionDigits ?? 2;
  return 10 ** fractionDigits;
}

export function parseMoneyToMinorUnits(value: string, currency = "USD"): number {
  const trimmed = value.trim();
  const scale = currencyMinorUnitScale(currency);
  const fractionDigits = Math.round(Math.log10(scale));
  const fractionPattern = fractionDigits === 0 ? "" : `(?:\\.\\d{1,${fractionDigits}})?`;
  if (!new RegExp(`^\\d+${fractionPattern}$`).test(trimmed)) {
    throw new Error(`Enter an amount with up to ${fractionDigits} decimal places.`);
  }
  const [whole, fractional = ""] = trimmed.split(".");
  const amount = Number(whole) * scale + Number(fractional.padEnd(fractionDigits, "0"));
  if (!Number.isSafeInteger(amount)) throw new Error("Amount is too large.");
  positiveMinorAmount(amount, "Amount");
  return amount;
}

export function formatMoney(minor: number, currency: string): string {
  const scale = currencyMinorUnitScale(currency);
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
  }).format(minor / scale);
}

export function moneyInputValue(minor?: number, currency = "USD") {
  if (minor === undefined) return "";
  const scale = currencyMinorUnitScale(currency);
  const fractionDigits = Math.round(Math.log10(scale));
  return (minor / scale).toFixed(fractionDigits);
}

export function currentMonthKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function previousMonthKey(month: string): string {
  if (!isMonthKey(month)) throw new Error("Choose a valid budget month.");
  const [year, monthNumber] = month.split("-").map(Number);
  const previous = new Date(year, monthNumber - 2, 1);
  return `${previous.getFullYear()}-${String(previous.getMonth() + 1).padStart(2, "0")}`;
}

export function goalProgressPercent(currentMinor: number, targetMinor: number): number {
  if (!Number.isFinite(currentMinor) || !Number.isFinite(targetMinor) || targetMinor <= 0) return 0;
  return Math.min(100, Math.max(0, currentMinor / targetMinor * 100));
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

export function isCreditCardPaymentMovement(transaction: Pick<FinancialTransaction, "category" | "description">): boolean {
  return /\b(?:(?:credit[\s-]*)?card|cc)\s+(?:payment|payoff)\b/i.test(`${transaction.category} ${transaction.description}`);
}

export function isOrdinaryExpenseTransaction(transaction: Pick<FinancialTransaction, "type" | "purpose" | "category" | "description">): boolean {
  return transaction.purpose === "ordinary"
    && (transaction.type === "debit" || transaction.type === "credit")
    && !isCreditCardPaymentMovement(transaction);
}

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
    .filter(isOrdinaryExpenseTransaction)
    .reduce((sum, item) => sum + (item.type === "credit" ? -item.amountMinor : item.amountMinor), 0);
  const investmentContributionsMinor = currentTransactions
    .filter((item) => (item.type === "debit" || item.type === "transfer") && item.purpose === "investment")
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
  initialSnapshotMonth?: string,
) {
  if (initialSnapshotMonth && !isMonthKey(initialSnapshotMonth)) {
    throw new Error("Choose a valid initial snapshot month.");
  }
  if (existing && existing.balanceMinor !== input.balanceMinor) {
    throw new Error("Account balances can only change through a transfer.");
  }
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
  if (!existing && initialSnapshotMonth) {
    const batch = writeBatch(database);
    batch.set(reference, values);
    batch.set(doc(database, ...path(householdId, "accounts"), reference.id, "snapshots", initialSnapshotMonth), {
      month: initialSnapshotMonth,
      amountMinor: input.balanceMinor,
      recordedBy: actorUid,
      createdAt: serverTimestamp(),
    });
    await batch.commit();
  } else {
    await setDoc(reference, values);
  }
  return reference.id;
}

export async function deleteAccount(database: Firestore, householdId: string, accountId: string) {
  const transactions = collection(database, ...path(householdId, "transactions"));
  const [destinationReferences, sourceReferences] = await Promise.all([
    getDocs(query(transactions, where("accountId", "==", accountId))),
    getDocs(query(transactions, where("sourceAccountId", "==", accountId))),
  ]);
  if ([...destinationReferences.docs, ...sourceReferences.docs].some((transaction) => {
    const data = transaction.data();
    return data.type === "transfer" && data.ledgerApplied === true;
  })) {
    throw new Error("Delete transfers linked to this account before deleting the account.");
  }
  const snapshots = await getDocs(collection(database, ...path(householdId, "accounts"), accountId, "snapshots"));
  for (let index = 0; index < snapshots.docs.length; index += 450) {
    const batch = writeBatch(database);
    snapshots.docs.slice(index, index + 450).forEach((snapshot) => batch.delete(snapshot.ref));
    await batch.commit();
  }
  await deleteDoc(doc(database, ...path(householdId, "accounts"), accountId));
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
  "type" | "purpose" | "transferDestination" | "category" | "description" | "amountMinor" | "date" | "accountId" | "sourceAccountId" | "ownerUid"
>;

export async function saveTransaction(
  database: Firestore,
  householdId: string,
  actorUid: string,
  input: TransactionInput,
  existing?: FinancialTransaction,
) {
  if (!(TRANSACTION_CATEGORIES as readonly string[]).includes(input.category)
    && input.category !== existing?.category) {
    throw new Error("Choose one of the supported transaction categories.");
  }
  positiveMinorAmount(input.amountMinor, "Transaction amount");
  const validClassification = (input.type === "credit" && (input.purpose === "income" || input.purpose === "ordinary"))
    || (input.type === "debit" && (input.purpose === "ordinary" || input.purpose === "investment"))
    || (input.type === "transfer" && input.purpose === "investment" && (input.transferDestination === "brokerage" || input.transferDestination === "retirement" || input.transferDestination === "cash"));
  if (!validClassification) throw new Error("Choose a valid income, expense, or transfer type.");
  if (input.type === "transfer" ? input.transferDestination === null : input.transferDestination !== null) {
    throw new Error("Choose an investment destination for the transfer.");
  }
  if (input.type === "transfer") {
    if (!input.accountId) throw new Error("Choose a destination account.");
    if (input.sourceAccountId && input.accountId === input.sourceAccountId) {
      throw new Error("Source and destination accounts must be different.");
    }
    if (!input.sourceAccountId && input.category !== "Paycheck transfer") {
      throw new Error("Paycheck allocations must use the Paycheck transfer category.");
    }
  } else if (input.sourceAccountId) {
    throw new Error("Only transfers can have a source account.");
  }
  if (!isCalendarDate(input.date)) {
    throw new Error("Choose a valid transaction date.");
  }
  if (input.amountMinor <= 0) throw new Error("Transaction amount must be greater than zero.");
  const reference = existing
    ? doc(database, ...path(householdId, "transactions"), existing.id)
    : doc(collection(database, ...path(householdId, "transactions")));
  await runTransaction(database, async (databaseTransaction) => {
    const previousSnapshot = existing ? await databaseTransaction.get(reference) : undefined;
    const previous = previousSnapshot?.exists() ? previousSnapshot.data() as FinancialTransaction : undefined;
    const deltas = new Map<string, number>();
    if (previous?.type === "transfer" && previous.ledgerApplied && previous.sourceAccountId && previous.accountId) {
      deltas.set(previous.sourceAccountId, (deltas.get(previous.sourceAccountId) ?? 0) + previous.amountMinor);
      deltas.set(previous.accountId, (deltas.get(previous.accountId) ?? 0) - previous.amountMinor);
    } else if (previous?.type === "transfer" && previous.ledgerApplied && previous.accountId) {
      deltas.set(previous.accountId, (deltas.get(previous.accountId) ?? 0) - previous.amountMinor);
    }
    if (input.type === "transfer") {
      if (input.sourceAccountId) {
        deltas.set(input.sourceAccountId, (deltas.get(input.sourceAccountId) ?? 0) - input.amountMinor);
      }
      deltas.set(input.accountId!, (deltas.get(input.accountId!) ?? 0) + input.amountMinor);
    }

    const accountReferences = new Map([...deltas.keys()].map((id) => [id, doc(database, ...path(householdId, "accounts"), id)]));
    const accountSnapshots = new Map(await Promise.all([...accountReferences].map(async ([id, accountReference]) => [
      id,
      await databaseTransaction.get(accountReference),
    ] as const)));
    const nextBalances = new Map<string, number>();
    for (const [id, delta] of deltas) {
      const snapshot = accountSnapshots.get(id);
      if (!snapshot?.exists()) throw new Error("A transfer account no longer exists.");
      const account = snapshot.data() as FinancialAccount;
      if (input.type === "transfer" && (id === input.sourceAccountId || id === input.accountId) && account.archived) {
        throw new Error("Transfers must use active accounts.");
      }
      const expectedKind = input.type === "transfer" && id === input.accountId
        ? input.transferDestination === "brokerage" ? "brokerage" : input.transferDestination === "retirement" ? "retirement" : "savings"
        : undefined;
      if (expectedKind && account.kind !== expectedKind) throw new Error("Choose a destination account that matches the selected investment type.");
      const nextBalance = account.balanceMinor + delta;
      if (!Number.isSafeInteger(nextBalance) || nextBalance < 0) {
        throw new Error("The source account does not have enough balance for this transfer.");
      }
      nextBalances.set(id, nextBalance);
    }

    for (const [id, balanceMinor] of nextBalances) {
      databaseTransaction.update(accountReferences.get(id)!, { balanceMinor, updatedAt: serverTimestamp() });
    }
    databaseTransaction.set(reference, {
      ...input,
      sourceAccountId: input.type === "transfer" ? input.sourceAccountId ?? null : null,
      ledgerApplied: input.type === "transfer",
      createdBy: previous?.createdBy ?? actorUid,
      createdAt: previous?.createdAt ?? serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });
  return reference.id;
}

export async function deleteTransaction(database: Firestore, householdId: string, id: string) {
  const reference = doc(database, ...path(householdId, "transactions"), id);
  await runTransaction(database, async (databaseTransaction) => {
    const snapshot = await databaseTransaction.get(reference);
    if (!snapshot.exists()) return;
    const transaction = snapshot.data() as FinancialTransaction;
    const accountIds = transaction.type === "transfer" && transaction.ledgerApplied
      ? [transaction.sourceAccountId, transaction.accountId].filter((accountId): accountId is string => Boolean(accountId))
      : [];
    const accountReferences = accountIds.map((accountId) => doc(database, ...path(householdId, "accounts"), accountId));
    const accountSnapshots = await Promise.all(accountReferences.map((accountReference) => databaseTransaction.get(accountReference)));
    accountSnapshots.forEach((accountSnapshot, index) => {
      if (!accountSnapshot.exists()) throw new Error("A transfer account no longer exists; the transfer cannot be deleted safely.");
      const accountId = accountIds[index];
      const account = accountSnapshot.data() as FinancialAccount;
      const delta = accountId === transaction.sourceAccountId ? transaction.amountMinor : -transaction.amountMinor;
      const balanceMinor = account.balanceMinor + delta;
      if (!Number.isSafeInteger(balanceMinor) || balanceMinor < 0) throw new Error("The transfer cannot be reversed because it would make an account balance negative.");
      databaseTransaction.update(accountReferences[index], { balanceMinor, updatedAt: serverTimestamp() });
    });
    databaseTransaction.delete(reference);
  });
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

type BudgetInput = Pick<MonthlyBudget, "month" | "period" | "category" | "limitMinor">;
export async function saveBudget(
  database: Firestore,
  householdId: string,
  actorUid: string,
  input: BudgetInput,
  existing?: MonthlyBudget,
) {
  positiveMinorAmount(input.limitMinor, "Budget");
  if (!isMonthKey(input.month)) throw new Error("Choose a valid budget month.");
  const period = input.period ?? "monthly";
  if (period !== "monthly" && period !== "yearly") {
    throw new Error("Choose a monthly or yearly budget period.");
  }
  if (!(BUDGET_CATEGORIES as readonly string[]).includes(input.category)
    && input.category !== existing?.category) {
    throw new Error("Choose a category used for household expenses.");
  }
  const reference = existing
    ? doc(database, ...path(householdId, "budgets"), existing.id)
    : doc(collection(database, ...path(householdId, "budgets")));
  await setDoc(reference, {
    ...input,
    period,
    createdBy: existing?.createdBy ?? actorUid,
    createdAt: existing?.createdAt ?? serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return reference.id;
}

export async function copyPreviousMonthBudgets(
  database: Firestore,
  householdId: string,
  actorUid: string,
  sourceMonth: string,
  targetMonth: string,
  budgets: MonthlyBudget[],
) {
  if (!isMonthKey(sourceMonth) || !isMonthKey(targetMonth)) {
    throw new Error("Choose valid months to copy budgets.");
  }
  const sourceBudgets = budgets.filter(
    (budget) => (budget.period ?? "monthly") === "monthly" && budget.month === sourceMonth,
  );
  if (!sourceBudgets.length) {
    throw new Error(`There are no budgets to copy from ${sourceMonth}.`);
  }

  const targetByCategory = new Map(
    budgets
      .filter((budget) => (budget.period ?? "monthly") === "monthly" && budget.month === targetMonth)
      .map((budget) => [budget.category, budget]),
  );
  const batch = writeBatch(database);
  let added = 0;
  let updated = 0;
  for (const budget of sourceBudgets) {
    const target = targetByCategory.get(budget.category);
    const reference = target
      ? doc(database, ...path(householdId, "budgets"), target.id)
      : doc(collection(database, ...path(householdId, "budgets")));
    if (target) updated += 1;
    else added += 1;
    batch.set(reference, {
      month: targetMonth,
      period: "monthly",
      category: budget.category,
      limitMinor: budget.limitMinor,
      createdBy: target?.createdBy ?? actorUid,
      createdAt: target?.createdAt ?? serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }
  await batch.commit();
  return { added, updated };
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

export async function addGoalProgress(
  database: Firestore,
  householdId: string,
  goalId: string,
  amountMinor: number,
) {
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    throw new Error("Progress update must be a positive amount in cents.");
  }
  await updateDoc(doc(database, ...path(householdId, "goals"), goalId), {
    currentMinor: increment(amountMinor),
    updatedAt: serverTimestamp(),
  });
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
    .filter((item) => ((budget.period ?? "monthly") === "yearly"
      ? item.date.startsWith(`${budget.month.slice(0, 4)}-`)
      : item.date.startsWith(`${budget.month}-`))
      && isOrdinaryExpenseTransaction(item)
      && item.category === budget.category)
    .reduce((sum, item) => sum + (item.type === "credit" ? -item.amountMinor : item.amountMinor), 0);
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
