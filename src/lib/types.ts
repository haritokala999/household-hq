import type { Timestamp } from "firebase/firestore";

export type Household = {
  name: string;
  currency: HouseholdCurrency;
  ownerUid: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export const HOUSEHOLD_CURRENCIES = ["USD", "CAD", "EUR", "GBP", "INR", "SAR", "KWD"] as const;
export type HouseholdCurrency = (typeof HOUSEHOLD_CURRENCIES)[number];
export const HOUSEHOLD_CURRENCY_NAMES: Record<HouseholdCurrency, string> = {
  USD: "US Dollar",
  CAD: "Canadian Dollar",
  EUR: "Euro",
  GBP: "British Pound",
  INR: "Indian Rupee",
  SAR: "Saudi Riyal",
  KWD: "Kuwaiti Dinar",
};

export type HouseholdMembership = {
  uid: string;
  email: string | null;
  displayName: string | null;
  role: "owner" | "member";
  status: "active" | "pending";
  joinedAt: Timestamp;
  invitationId?: string | null;
  householdId: string;
  householdName: string;
  currency: HouseholdCurrency;
};

export type FinanceCategory = {
  id: string;
  name: string;
  kind: "income" | "expense" | "investment";
  isDefault: boolean;
  createdBy: string;
};

export type FinancialAccount = {
  id: string;
  name: string;
  kind: "savings" | "brokerage" | "retirement";
  ownerUid: string;
  balanceMinor: number;
  currency: HouseholdCurrency;
  archived: boolean;
  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export type AccountSnapshot = {
  id: string;
  month: string;
  amountMinor: number;
  recordedBy: string;
  createdAt: Timestamp;
};

export type FinancialTransaction = {
  id: string;
  type: "credit" | "debit" | "transfer";
  purpose: "income" | "ordinary" | "investment";
  transferDestination: "brokerage" | "cash" | null;
  category: string;
  description: string;
  amountMinor: number;
  date: string;
  accountId: string | null;
  ownerUid: string;
  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export type MonthlyBudget = {
  id: string;
  month: string;
  period?: "monthly" | "yearly";
  category: string;
  limitMinor: number;
  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export type SavingsGoal = {
  id: string;
  name: string;
  targetMinor: number;
  currentMinor: number;
  deadline: string | null;
  ownerUid: string;
  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export type RecurringPayment = {
  id: string;
  name: string;
  amountMinor: number;
  dueDay: number;
  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export type ManualValueRecord = {
  id: string;
  name: string;
  amountMinor: number;
  ownerUid: string;
  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export type HouseholdInvitation = {
  id: string;
  householdId: string;
  code: string;
  createdBy: string;
  createdAt: Timestamp;
  expiresAt: Timestamp;
  status: "pending" | "accepted";
  acceptedBy: string | null;
  acceptedAt: Timestamp | null;
};

export type HouseholdMember = {
  uid: string;
  email: string | null;
  displayName: string | null;
  role: "owner" | "member";
  status: "active";
};

export const DEFAULT_CATEGORIES: ReadonlyArray<{
  id: string;
  name: string;
  kind: FinanceCategory["kind"];
}> = [
  { id: "cat-paycheck", name: "Paycheck", kind: "income" },
  { id: "cat-income-other", name: "Other income", kind: "income" },
  { id: "cat-groceries", name: "Groceries", kind: "expense" },
  { id: "cat-bills", name: "Bills", kind: "expense" },
  { id: "cat-shopping", name: "Shopping", kind: "expense" },
  { id: "cat-loan-payment", name: "Loan payment", kind: "expense" },
  { id: "cat-other-expense", name: "Other expense", kind: "expense" },
  { id: "cat-investment", name: "Investment contribution", kind: "investment" },
];
