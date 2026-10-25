import assert from "node:assert/strict";
import test from "node:test";
import {
  BUDGET_CATEGORIES,
  budgetProgress,
  calculateFinanceSummary,
  goalProgressPercent,
  isCalendarDate,
  isMonthKey,
  parseMoneyToMinorUnits,
  previousMonthKey,
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

test("yearly budget progress includes matching ordinary expenses across the year", () => {
  const result = budgetProgress({
    id: "yearly",
    month: "2026-01",
    period: "yearly",
    category: "Groceries",
    limitMinor: 120000,
  } as never, [
    transaction({ amountMinor: 10000, date: "2026-01-10" }),
    transaction({ amountMinor: 25000, date: "2026-10-10" }),
    transaction({ amountMinor: 99999, date: "2025-12-31" }),
    transaction({ amountMinor: 50000, date: "2026-03-01", category: "Bills" }),
    transaction({ amountMinor: 50000, date: "2026-03-01", purpose: "investment" }),
  ]);
  assert.deepEqual(result, {
    spentMinor: 35000,
    remainingMinor: 85000,
    percent: 29,
    overspent: false,
  });
});

test("previous month handles year boundaries", () => {
  assert.equal(previousMonthKey("2026-01"), "2025-12");
  assert.equal(previousMonthKey("2026-10"), "2026-09");
  assert.throws(() => previousMonthKey("2026-13"));
});

test("month and calendar dates are strictly validated", () => {
  assert.equal(isMonthKey("2026-10"), true);
  assert.equal(isMonthKey("2026-13"), false);
  assert.equal(isCalendarDate("2024-02-29"), true);
  assert.equal(isCalendarDate("2026-02-29"), false);
  assert.equal(isCalendarDate("2026-04-31"), false);
});

test("goal progress uses precise bounded percentages", () => {
  assert.equal(goalProgressPercent(0, 10000), 0);
  assert.equal(goalProgressPercent(1, 10000), 0.01);
  assert.equal(goalProgressPercent(2500, 10000), 25);
  assert.equal(goalProgressPercent(15000, 10000), 100);
  assert.equal(goalProgressPercent(100, 0), 0);
});

test("new households initialize required income, expense, and investment categories", () => {
  assert.ok(TRANSACTION_CATEGORIES.includes("Paycheck"));
  assert.ok(TRANSACTION_CATEGORIES.includes("India Transfer"));
  assert.ok(BUDGET_CATEGORIES.includes("India Transfer"));
  assert.ok(!(BUDGET_CATEGORIES as readonly string[]).includes("Paycheck"));
  assert.ok(!(BUDGET_CATEGORIES as readonly string[]).includes("Savings and expenses"));
  assert.ok(DEFAULT_CATEGORIES.some((category) => category.name === "Paycheck" && category.kind === "income"));
  assert.ok(DEFAULT_CATEGORIES.some((category) => category.name === "Groceries" && category.kind === "expense"));
  assert.ok(DEFAULT_CATEGORIES.some((category) => category.kind === "investment"));
});
