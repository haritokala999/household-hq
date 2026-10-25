
"use client";

import { useState } from "react";
import AuthGuard from "@/components/auth-guard";
import { useRouter } from "next/navigation";
import { signOutUser } from "@/lib/auth";


const transactions = [
  { name: "Monthly salary", category: "Income", date: "Oct 23", account: "Checking", amount: 12000, type: "income", owner: "You" },
  { name: "Rent payment", category: "Housing", date: "Oct 22", account: "Checking", amount: -2800, type: "expense", owner: "Shared" },
  { name: "Grocery shopping", category: "Groceries", date: "Oct 21", account: "Credit card", amount: -146.82, type: "expense", owner: "Shared" },
  { name: "Electricity bill", category: "Utilities", date: "Oct 20", account: "Checking", amount: -84.50, type: "expense", owner: "Shared" },
  { name: "Restaurant", category: "Dining", date: "Oct 19", account: "Credit card", amount: -62.40, type: "expense", owner: "You" },
];

const budgets = [
  { name: "Housing", spent: 2800, limit: 3000, color: "bg-blue-500" },
  { name: "Groceries", spent: 640, limit: 800, color: "bg-emerald-500" },
  { name: "Dining out", spent: 320, limit: 400, color: "bg-amber-500" },
  { name: "Transportation", spent: 185, limit: 300, color: "bg-violet-500" },
];

const navigation = [
  { label: "Dashboard", icon: "▦" },
  { label: "Transactions", icon: "⇄" },
  { label: "Budgets", icon: "◷" },
  { label: "Accounts", icon: "▤" },
  { label: "Goals", icon: "◎" },
];

const money = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);

export default function Home() {
  const [active, setActive] = useState("Dashboard");
  const [period, setPeriod] = useState("This month");
  const router = useRouter();

async function handleSignOut() {
  try {
    await signOutUser();
    router.replace("/login");
  } catch (error) {
    console.error("Sign-out failed:", error);
  }
}

  return (
     <AuthGuard>
    <main className="min-h-screen bg-[#f7f8fa] text-slate-900 md:flex">
      <aside className="flex w-full shrink-0 flex-col border-b border-slate-200 bg-white md:min-h-screen md:w-64 md:border-b-0 md:border-r">
        <div className="flex items-center gap-3 px-6 py-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600 text-xl font-bold text-white">
            H
          </div>
          <div>
            <p className="text-lg font-bold tracking-tight">Household HQ</p>
            <p className="text-xs text-slate-500">Your money, together.</p>
          </div>
        </div>

        <div className="px-4 pb-4">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs text-slate-500">HOUSEHOLD</p>
            <p className="mt-1 font-semibold">Our home</p>
            <p className="mt-1 text-xs text-slate-500">2 members · Demo workspace</p>
          </div>
        </div>

        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:overflow-visible">
          <p className="hidden px-3 pb-2 pt-3 text-xs font-semibold uppercase tracking-wider text-slate-400 md:block">
            Workspace
          </p>
          {navigation.map((item) => (
            <button
              key={item.label}
              onClick={() => setActive(item.label)}
              className={`flex shrink-0 items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition ${
                active === item.label
                  ? "bg-emerald-50 text-emerald-800"
                  : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              <span className="w-5 text-center text-lg">{item.icon}</span>
              {item.label}
              {item.label === "Transactions" && (
                <span className="ml-auto hidden rounded-md bg-slate-100 px-2 py-0.5 text-xs md:inline">
                  5
                </span>
              )}
            </button>
          ))}
        </nav>

        <div className="mt-auto hidden p-4 md:block">
          <div className="rounded-xl bg-slate-900 p-4 text-white">
            <p className="text-sm font-semibold">Your next milestone</p>
            <p className="mt-1 text-xs leading-5 text-slate-300">
              Start tracking your goals and build your financial future together.
            </p>
            <button
              onClick={() => setActive("Goals")}
              className="mt-3 rounded-lg bg-white px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-100"
            >
              Explore goals →
            </button>
          </div>
          <p className="mt-4 text-xs text-slate-400">Household HQ · Preview v0.1</p>
        </div>
      </aside>

      <section className="min-w-0 flex-1">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4 sm:px-8">
          <div>
            <p className="text-sm text-slate-500">Saturday, October 24, 2026</p>
            <h1 className="mt-1 text-xl font-bold tracking-tight">
              {active === "Dashboard" ? "Your household overview" : active}
            </h1>
          </div>
          
<div className="flex items-center gap-3">
  <span className="hidden rounded-full bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800 sm:inline-flex">
    Demo data
  </span>
  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-100 text-sm font-bold text-violet-800">
    HH
  </div>
  <button
    type="button"
    onClick={handleSignOut}
    className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium hover:bg-slate-50"
  >
    Sign out
  </button>
</div>

        </header>

        <div className="mx-auto max-w-7xl space-y-6 p-5 sm:p-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold">Financial snapshot</h2>
              <p className="mt-1 text-sm text-slate-500">
                A clear picture of your household finances.
              </p>
            </div>
            <select
              value={period}
              onChange={(event) => setPeriod(event.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500"
              aria-label="Reporting period"
            >
              <option>This month</option>
              <option>Last month</option>
              <option>This year</option>
            </select>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              title="Total net worth"
              value="$184,250"
              detail="Assets minus liabilities"
              icon="◈"
              accent="emerald"
            />
            <MetricCard
              title="Monthly income"
              value="$16,500"
              detail="Combined household income"
              icon="↗"
              accent="blue"
            />
            <MetricCard
              title="Monthly spending"
              value="$5,842"
              detail="35.4% of income"
              icon="↘"
              accent="amber"
            />
            <MetricCard
              title="Savings rate"
              value="64.6%"
              detail="$10,658 remaining"
              icon="◎"
              accent="violet"
            />
          </div>

          <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
            <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-bold">Income vs. expenses</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Monthly cash flow · {period.toLowerCase()}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold">$10,658</p>
                  <p className="text-xs text-emerald-700">Income after spending</p>
                </div>
              </div>

              <div className="mt-7 flex h-52 items-end justify-around gap-3 border-b border-slate-100 pb-2">
                {[
                  { month: "May", income: 76, expense: 39 },
                  { month: "Jun", income: 86, expense: 43 },
                  { month: "Jul", income: 82, expense: 37 },
                  { month: "Aug", income: 91, expense: 48 },
                  { month: "Sep", income: 84, expense: 42 },
                  { month: "Oct", income: 96, expense: 35 },
                ].map((item) => (
                  <div key={item.month} className="flex h-full flex-1 flex-col items-center justify-end gap-2">
                    <div className="flex h-full w-full items-end justify-center gap-1">
                      <div
                        title="Income"
                        style={{ height: `${item.income}%` }}
                        className="w-3 rounded-t-md bg-emerald-500 sm:w-5"
                      />
                      <div
                        title="Expenses"
                        style={{ height: `${item.expense}%` }}
                        className="w-3 rounded-t-md bg-slate-200 sm:w-5"
                      />
                    </div>
                    <span className="text-xs text-slate-500">{item.month}</span>
                  </div>
                ))}
              </div>

              <div className="mt-4 flex gap-5 text-xs text-slate-500">
                <span className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" /> Income
                </span>
                <span className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-sm bg-slate-200" /> Expenses
                </span>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-bold">Monthly budget</h2>
                  <p className="mt-1 text-sm text-slate-500">Spending by category</p>
                </div>
                <button
                  onClick={() => setActive("Budgets")}
                  className="text-sm font-semibold text-emerald-700 hover:text-emerald-900"
                >
                  View all →
                </button>
              </div>

              <div className="mt-6 space-y-5">
                {budgets.map((budget) => {
                  const percent = Math.round((budget.spent / budget.limit) * 100);
                  return (
                    <div key={budget.name}>
                      <div className="mb-2 flex items-center justify-between gap-2 text-sm">
                        <span className="font-medium">{budget.name}</span>
                        <span className="text-slate-500">
                          {money(budget.spent)} <span className="text-slate-300">/</span>{" "}
                          {money(budget.limit)}
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className={`h-full rounded-full ${budget.color}`}
                          style={{ width: `${Math.min(percent, 100)}%` }}
                        />
                      </div>
                      <p className="mt-1.5 text-right text-xs text-slate-400">
                        {percent}% used
                      </p>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>

          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="flex flex-wrap items-center justify-between gap-3 p-5 sm:p-6">
              <div>
                <h2 className="font-bold">Recent transactions</h2>
                <p className="mt-1 text-sm text-slate-500">
                  The latest activity across your household.
                </p>
              </div>
              <button
                onClick={() => setActive("Transactions")}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold hover:bg-slate-50"
              >
                View transactions →
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-y border-slate-100 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-5 py-3 font-medium sm:px-6">Transaction</th>
                    <th className="hidden px-5 py-3 font-medium sm:table-cell">Date</th>
                    <th className="px-5 py-3 font-medium">Owner</th>
                    <th className="hidden px-5 py-3 font-medium md:table-cell">Account</th>
                    <th className="px-5 py-3 text-right font-medium sm:px-6">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {transactions.map((transaction) => (
                    <tr key={transaction.name} className="hover:bg-slate-50/70">
                      <td className="px-5 py-4 sm:px-6">
                        <p className="font-semibold">{transaction.name}</p>
                        <p className="mt-1 text-xs text-slate-500">{transaction.category}</p>
                      </td>
                      <td className="hidden px-5 py-4 text-slate-500 sm:table-cell">
                        {transaction.date}
                      </td>
                      <td className="px-5 py-4">
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">
                          {transaction.owner}
                        </span>
                      </td>
                      <td className="hidden px-5 py-4 text-slate-500 md:table-cell">
                        {transaction.account}
                      </td>
                      <td className={`whitespace-nowrap px-5 py-4 text-right font-semibold sm:px-6 ${transaction.type === "income" ? "text-emerald-700" : "text-slate-800"}`}>
                        {transaction.amount > 0 ? "+" : "−"}
                        {money(Math.abs(transaction.amount))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t border-slate-100 px-6 py-3 text-xs text-slate-400">
              Sample transactions only · No real financial accounts are connected.
            </div>
          </section>

          <footer className="pb-3 text-center text-xs text-slate-400">
            Household HQ · Built for your household, designed for your future.
          </footer>
        </div>
      </section>
    </main>
     </AuthGuard>
  );
}

function MetricCard({
  title,
  value,
  detail,
  icon,
  accent,
}: {
  title: string;
  value: string;
  detail: string;
  icon: string;
  accent: "emerald" | "blue" | "amber" | "violet";
}) {
  const styles = {
    emerald: "bg-emerald-50 text-emerald-700",
    blue: "bg-blue-50 text-blue-700",
    amber: "bg-amber-50 text-amber-700",
    violet: "bg-violet-50 text-violet-700",
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-slate-500">{title}</p>
        <span className={`flex h-9 w-9 items-center justify-center rounded-xl text-lg ${styles[accent]}`}>
          {icon}
        </span>
      </div>
      <p className="mt-4 text-2xl font-bold tracking-tight sm:text-3xl">{value}</p>
      <p className="mt-2 text-xs text-slate-500">{detail}</p>
    </div>
  );
}
