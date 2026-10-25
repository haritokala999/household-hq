import assert from "node:assert/strict";
import test from "node:test";
import {
  budgetProgress,
  calculateFinanceSummary,
  isCalendarDate,
  isMonthKey,
  parseMoneyToMinorUnits,
  TRANSACTION_CATEGORIES,
} from "../src/lib/finance";
import { DEFAULT_CATEGORIES, type FinancialTransaction } from "../src/lib/types";

const transaction = (overrides: Partial<FinancialTransaction>): FinancialTransaction => ({
  id: "tx",
  type: "debit",
  purpose: "ordinary",
  transferDestination: null,
  category: "Groceries",
  description: "",
  amountMinor: 1000,
  date: "2026-10-10",
  accountId: null,
  ownerUid: "alice",
  createdBy: "alice",
  createdAt: undefined as never,
  updatedAt: undefined as never,
  ...overrides,
});

test("money parsing uses integer minor units and rejects invalid precision", () => {
  assert.equal(parseMoneyToMinorUnits("1234.5"), 123450);
  assert.equal(parseMoneyToMinorUnits("0.01"), 1);
  assert.throws(() => parseMoneyToMinorUnits("1.001"));
  assert.throws(() => parseMoneyToMinorUnits("-1"));
});

test("financial summary separates income, ordinary expenses, investment, and net worth", () => {
  const summary = calculateFinanceSummary({
    accounts: [
      { balanceMinor: 100000, archived: false },
      { balanceMinor: 20000, archived: true },
    ] as never,
    assets: [{ amountMinor: 30000 }] as never,
    liabilities: [{ amountMinor: 40000 }] as never,
    transactions: [
      transaction({ type: "credit", purpose: "income", amountMinor: 50000 }),
      transaction({ type: "debit", purpose: "ordinary", amountMinor: 12000 }),
      transaction({ type: "debit", purpose: "investment", amountMinor: 8000 }),
      transaction({ type: "transfer", purpose: "investment", transferDestination: "brokerage", amountMinor: 6000 }),
      transaction({ type: "credit", purpose: "income", date: "2026-09-30", amountMinor: 90000 }),
    ],
  }, "2026-10");
  assert.deepEqual(summary, {
    assetsMinor: 130000,
    liabilitiesMinor: 40000,
    netWorthMinor: 90000,
    incomeMinor: 50000,
    ordinaryExpensesMinor: 12000,
    investmentContributionsMinor: 14000,
    availableToSpendMinor: 24000,
  });
});

test("budget progress filters month, ordinary debits, and category and reports overspending", () => {
  const result = budgetProgress({ id: "b", month: "2026-10", category: "Groceries", limitMinor: 1500 } as never, [
    transaction({ amountMinor: 1000 }),
    transaction({ amountMinor: 700 }),
    transaction({ category: "Bills", amountMinor: 800 }),
    transaction({ date: "2026-09-30", amountMinor: 900 }),
    transaction({ purpose: "investment", amountMinor: 200 }),
  ]);
  assert.deepEqual(result, { spentMinor: 1700, remainingMinor: -200, percent: 113, overspent: true });
});

test("month and calendar dates are strictly validated", () => {
  assert.equal(isMonthKey("2026-10"), true);
  assert.equal(isMonthKey("2026-13"), false);
  assert.equal(isCalendarDate("2024-02-29"), true);
  assert.equal(isCalendarDate("2026-02-29"), false);
  assert.equal(isCalendarDate("2026-04-31"), false);
});

test("new households initialize required income, expense, and investment categories", () => {
  assert.ok(TRANSACTION_CATEGORIES.includes("Paycheck"));
  assert.ok(DEFAULT_CATEGORIES.some((category) => category.name === "Paycheck" && category.kind === "income"));
  assert.ok(DEFAULT_CATEGORIES.some((category) => category.name === "Groceries" && category.kind === "expense"));
  assert.ok(DEFAULT_CATEGORIES.some((category) => category.kind === "investment"));
});
