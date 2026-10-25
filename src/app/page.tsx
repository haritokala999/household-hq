"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { doc, getDoc } from "firebase/firestore";
import AuthGuard from "@/components/auth-guard";
import { useHouseholds } from "@/hooks/use-households";
import { auth } from "@/lib/firebase";
import { signOutUser } from "@/lib/auth";
import { db } from "@/lib/firebase";
import {
  promoteHouseholdMemberToOwner,
  renameHousehold,
  transferHouseholdOwnership,
} from "@/lib/households";
import { createHouseholdInvitation, INVITATION_CODE_LENGTH, INVITATION_LIFETIME_DAYS } from "@/lib/invitations";
import {
  addAccountSnapshot,
  archiveAccount,
  budgetProgress,
  calculateFinanceSummary,
  currentMonthKey,
  deleteRecord,
  deleteTransaction,
  formatMoney,
  getAccountSnapshots,
  loadHouseholdFinance,
  parseMoneyToMinorUnits,
  saveAccount,
  saveBudget,
  saveCategory,
  saveGoal,
  saveManualValue,
  saveTransaction,
  type HouseholdFinanceData,
} from "@/lib/finance";
import { getHouseholdMembers } from "@/lib/household-memberships";
import type {
  AccountSnapshot,
  FinancialAccount,
  FinancialTransaction,
  HouseholdMember,
  ManualValueRecord,
  MonthlyBudget,
  SavingsGoal,
} from "@/lib/types";

type Section = "Overview" | "Accounts" | "Transactions" | "Budgets" | "Goals" | "Assets & debts" | "Household";
const sections: Section[] = ["Overview", "Accounts", "Transactions", "Budgets", "Goals", "Assets & debts", "Household"];
const inputClass = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-600";
const buttonClass = "rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60";
const secondaryButtonClass = "rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50";

const emptyFinance: HouseholdFinanceData = {
  accounts: [], categories: [], transactions: [], budgets: [], goals: [], assets: [], liabilities: [],
};

function moneyInputValue(minor?: number) {
  return minor === undefined ? "" : (minor / 100).toFixed(2);
}

export default function Home() {
  const router = useRouter();
  const { uid, households, activeHouseholdId, loading: householdsLoading, error: householdError, retry, selectHousehold } = useHouseholds();
  const [section, setSection] = useState<Section>("Overview");
  const [finance, setFinance] = useState<HouseholdFinanceData>(emptyFinance);
  const [members, setMembers] = useState<HouseholdMember[]>([]);
  const [loadingFinance, setLoadingFinance] = useState(false);
  const [financeError, setFinanceError] = useState("");
  const [notice, setNotice] = useState("");
  const [signOutError, setSignOutError] = useState("");
  const [signingOut, setSigningOut] = useState(false);
  const [month, setMonth] = useState("");
  const [transactionFilter, setTransactionFilter] = useState("");
  const [transactionTypeFilter, setTransactionTypeFilter] = useState("all");
  const [editingAccount, setEditingAccount] = useState<FinancialAccount | undefined>();
  const [editingTransaction, setEditingTransaction] = useState<FinancialTransaction | undefined>();
  const [editingBudget, setEditingBudget] = useState<MonthlyBudget | undefined>();
  const [editingGoal, setEditingGoal] = useState<SavingsGoal | undefined>();
  const [editingValue, setEditingValue] = useState<{ group: "assets" | "liabilities"; record: ManualValueRecord } | undefined>();
  const [snapshotHistory, setSnapshotHistory] = useState<Record<string, AccountSnapshot[]>>({});
  const [invitation, setInvitation] = useState<{ code: string; uid: string; householdId: string } | null>(null);
  const [editingHouseholdName, setEditingHouseholdName] = useState(false);
  const [householdNameDraft, setHouseholdNameDraft] = useState("");
  const [savingHouseholdName, setSavingHouseholdName] = useState(false);
  const [householdNameError, setHouseholdNameError] = useState("");
  const [transferringOwnership, setTransferringOwnership] = useState(false);
  const [promotingMember, setPromotingMember] = useState(false);

  const selectedHousehold = households.find((item) => item.householdId === activeHouseholdId)
    ?? (households.length === 1 ? households[0] : undefined);
  const householdId = selectedHousehold?.householdId;
  const invitationCode = invitation?.uid === uid
    && invitation.householdId === householdId
    && selectedHousehold?.role === "owner"
    ? invitation.code
    : "";
  const currency = selectedHousehold?.currency ?? "USD";
  const memberNames = useMemo(() => new Map(members.map((member) => [member.uid, member.displayName || member.email || member.uid])), [members]);
  const summary = useMemo(() => calculateFinanceSummary(finance, month), [finance, month]);

  const refresh = useCallback(async () => {
    if (!householdId) return;
    setLoadingFinance(true);
    setFinanceError("");
    try {
      const [nextFinance, nextMembers] = await Promise.all([
        loadHouseholdFinance(db, householdId),
        getHouseholdMembers(db, householdId),
      ]);
      setFinance(nextFinance);
      setMembers(nextMembers);
    } catch (cause) {
      setFinanceError(cause instanceof Error ? cause.message : "Could not load household data.");
    } finally {
      setLoadingFinance(false);
    }
  }, [householdId]);

  useEffect(() => {
    // Current time is runtime data and must not be read during prerendering.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMonth(currentMonthKey());
  }, []);

  useEffect(() => {
    if (!householdsLoading && !householdError && uid && households.length === 0) {
      router.replace("/household/setup");
    }
  }, [householdError, households.length, householdsLoading, router, uid]);

  // Clear data when switching household so records never flash across tenants.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFinance(emptyFinance);
    setMembers([]);
    setInvitation(null);
    if (householdId) void refresh();
  }, [householdId, refresh]);

  useEffect(() => {
    // Invitation codes are private UI state scoped to their creator.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setInvitation(null);
  }, [uid]);

  async function runAction(action: () => Promise<unknown>, successMessage = "Saved.") {
    setNotice("");
    setFinanceError("");
    try {
      await action();
      setNotice(successMessage);
      await refresh();
    } catch (cause) {
      setFinanceError(cause instanceof Error ? cause.message : "The change could not be saved.");
    }
  }

  async function handleSignOut() {
    setSigningOut(true);
    setSignOutError("");
    setInvitation(null);
    try {
      await signOutUser();
      router.replace("/login");
    } catch (cause) {
      setSignOutError(cause instanceof Error ? cause.message : "Could not sign out. Please try again.");
    } finally {
      setSigningOut(false);
    }
  }

  function startEditingHouseholdName() {
    if (!selectedHousehold) return;
    setHouseholdNameDraft(selectedHousehold.householdName);
    setHouseholdNameError("");
    setEditingHouseholdName(true);
  }

  async function handleRenameHousehold(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!householdId) return;
    setSavingHouseholdName(true);
    setHouseholdNameError("");
    try {
      await renameHousehold(householdId, householdNameDraft);
      setEditingHouseholdName(false);
      await retry();
    } catch (cause) {
      setHouseholdNameError(cause instanceof Error ? cause.message : "Could not rename the household.");
    } finally {
      setSavingHouseholdName(false);
    }
  }

  async function handleTransferOwnership(newOwnerUid: string, newOwnerName: string) {
    if (!householdId || !uid || transferringOwnership || promotingMember) return;
    const confirmed = window.confirm(
      `Make ${newOwnerName} the household owner? You will become a regular member.`,
    );
    if (!confirmed) return;

    setTransferringOwnership(true);
    setFinanceError("");
    setInvitation(null);
    try {
      await transferHouseholdOwnership(householdId, newOwnerUid);
      await Promise.all([retry(), refresh()]);
      setNotice(`${newOwnerName} is now the household owner. You are now a member.`);
    } catch (cause) {
      setFinanceError(cause instanceof Error ? cause.message : "Could not transfer household ownership.");
    } finally {
      setTransferringOwnership(false);
    }
  }

  async function handlePromoteMember(memberUid: string, memberName: string) {
    if (!householdId || !uid || promotingMember || transferringOwnership) return;
    const confirmed = window.confirm(
      `Promote ${memberName} to co-owner? You will remain an owner.`,
    );
    if (!confirmed) return;

    setPromotingMember(true);
    setFinanceError("");
    try {
      await promoteHouseholdMemberToOwner(householdId, memberUid);
      await Promise.all([retry(), refresh()]);
      setNotice(`${memberName} is now an owner. You remain an owner.`);
    } catch (cause) {
      setFinanceError(cause instanceof Error ? cause.message : "Could not promote the household member.");
    } finally {
      setPromotingMember(false);
    }
  }

  async function handleCreateInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!householdId || !uid) return;
    setInvitation(null);
    setFinanceError("");
    try {
      const currentUser = auth.currentUser;
      if (!currentUser || currentUser.uid !== uid) {
        throw new Error("Your sign-in changed. Refresh the page and sign in again before creating an invitation.");
      }
      const [householdSnapshot, memberSnapshot] = await Promise.all([
        getDoc(doc(db, "households", householdId)),
        getDoc(doc(db, "households", householdId, "members", uid)),
      ]);
      if (!householdSnapshot.exists() || !memberSnapshot.exists()) {
        throw new Error("Your household or membership record is missing. Refresh your household list and try again.");
      }
      const member = memberSnapshot.data();
      if (member.status !== "active" || member.role !== "owner") {
        throw new Error("This account is not an active household owner. Only an active owner can create invitation codes.");
      }
      if (householdSnapshot.data().ownerUid !== uid) {
        throw new Error("Your membership is marked as owner, but this household names a different owner account. The owner records need to be corrected before inviting members.");
      }
      const code = await createHouseholdInvitation(db, householdId, uid);
      setInvitation({ code, uid, householdId });
      setNotice(`Invitation created. It expires in ${INVITATION_LIFETIME_DAYS} days.`);
    } catch (cause) {
      setFinanceError(cause instanceof Error ? cause.message : "Could not create invitation.");
    }
  }

  if (householdsLoading) {
    return <AuthGuard><LoadingPanel label="Loading your household…" /></AuthGuard>;
  }

  if (householdError) {
    return <AuthGuard><main className="min-h-screen bg-[#f7f8fa] p-8"><ErrorPanel message={householdError} onRetry={retry} /></main></AuthGuard>;
  }

  if (households.length > 1 && !selectedHousehold) {
    return (
      <AuthGuard>
        <main className="min-h-screen bg-[#f7f8fa] p-5 text-slate-900 sm:p-8">
          <div className="mx-auto max-w-2xl rounded-2xl border border-slate-200 bg-white p-6">
            <h1 className="text-xl font-bold">Choose a household</h1>
            <ul className="mt-5 space-y-2">{households.map((item) => <li key={item.householdId}><button onClick={() => selectHousehold(item.householdId)} className="w-full rounded-xl border border-slate-200 p-4 text-left hover:border-emerald-600"><span className="block font-semibold">{item.householdName}</span><span className="mt-1 block text-sm text-slate-500">{item.role === "owner" ? "Owner" : "Member"} · {item.currency}</span></button></li>)}</ul>
          </div>
        </main>
      </AuthGuard>
    );
  }

  return (
    <AuthGuard>
      <main className="min-h-screen bg-[#f7f8fa] text-slate-900 md:flex">
        <aside className="flex w-full shrink-0 flex-col border-b border-slate-200 bg-white md:min-h-screen md:w-64 md:border-b-0 md:border-r">
          <div className="flex items-center gap-3 px-6 py-6"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600 text-xl font-bold text-white">H</div><div><p className="text-lg font-bold tracking-tight">Household HQ</p><p className="text-xs text-slate-500">Your money, together.</p></div></div>
          <div className="px-4 pb-4"><div className="rounded-xl border border-slate-200 bg-slate-50 p-3"><p className="text-xs text-slate-500">HOUSEHOLD</p>{editingHouseholdName ? <form onSubmit={handleRenameHousehold} className="mt-2 space-y-2"><input autoFocus required maxLength={80} aria-label="Household name" value={householdNameDraft} onChange={(event) => setHouseholdNameDraft(event.target.value)} className={inputClass} /><div className="flex gap-2"><button disabled={savingHouseholdName} className={`${buttonClass} px-3 py-2`}>{savingHouseholdName ? "Saving…" : "Save"}</button><button type="button" disabled={savingHouseholdName} onClick={() => { setEditingHouseholdName(false); setHouseholdNameError(""); }} className={secondaryButtonClass}>Cancel</button></div>{householdNameError && <p role="alert" className="text-xs text-red-700">{householdNameError}</p>}</form> : <div className="mt-1 flex items-center gap-2">{households.length > 1 ? <select aria-label="Active household" value={householdId} onChange={(event) => selectHousehold(event.target.value)} className="min-w-0 flex-1 bg-transparent font-semibold">{households.map((item) => <option key={item.householdId} value={item.householdId}>{item.householdName}</option>)}</select> : <p className="min-w-0 flex-1 truncate font-semibold">{selectedHousehold?.householdName}</p>}{selectedHousehold?.role === "owner" && <button type="button" aria-label="Edit household name" title="Edit household name" onClick={startEditingHouseholdName} className="rounded-md px-2 py-1 text-sm text-slate-500 hover:bg-white hover:text-emerald-800">✎</button>}</div>}<p className="mt-1 text-xs text-slate-500">{members.length} members · {currency}</p></div></div>
          <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:overflow-visible"><p className="hidden px-3 pb-2 pt-3 text-xs font-semibold uppercase tracking-wider text-slate-400 md:block">Workspace</p>{sections.map((item) => <button key={item} onClick={() => setSection(item)} className={`flex shrink-0 items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition ${section === item ? "bg-emerald-50 text-emerald-800" : "text-slate-600 hover:bg-slate-50"}`}>{item}</button>)}</nav>
          <div className="mt-auto hidden p-4 md:block"><div className="rounded-xl bg-slate-900 p-4 text-white"><p className="text-sm font-semibold">Your finances, together</p><p className="mt-1 text-xs leading-5 text-slate-300">Balances are entered manually. Transactions help you plan; they never change account balances.</p></div><p className="mt-4 text-xs text-slate-400">Household HQ · Shared workspace</p></div>
        </aside>

        <section className="min-w-0 flex-1">
          <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4 sm:px-8">
            <div><p className="text-sm text-slate-500">{selectedHousehold?.householdName}</p><h1 className="mt-1 text-xl font-bold tracking-tight">{section === "Overview" ? "Your household overview" : section}</h1></div>
            <div className="flex items-center gap-3">{signOutError && <span role="alert" className="text-sm text-red-700">{signOutError}</span>}<button disabled={signingOut} onClick={handleSignOut} className={secondaryButtonClass}>{signingOut ? "Signing out…" : "Sign out"}</button></div>
          </header>
          <div className="mx-auto max-w-7xl space-y-6 p-5 sm:p-8">
            {notice && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
            {financeError && <ErrorPanel message={financeError} onRetry={refresh} />}
            {loadingFinance ? <LoadingPanel label="Loading household records…" /> : (
              <>
                {section === "Overview" && <Overview finance={finance} summary={summary} month={month} setMonth={setMonth} currency={currency} memberNames={memberNames} onOpen={setSection} />}
                {section === "Accounts" && <AccountsSection finance={finance} currency={currency} uid={uid ?? ""} memberNames={memberNames} onSave={(input, existing) => runAction(() => saveAccount(db, householdId!, uid!, currency, input, existing), "Account saved.")} onArchive={(id) => runAction(() => archiveAccount(db, householdId!, id), "Account archived.")} editing={editingAccount} setEditing={setEditingAccount} snapshots={snapshotHistory} loadSnapshots={async (accountId) => { const items = await getAccountSnapshots(db, householdId!, accountId); setSnapshotHistory((current) => ({ ...current, [accountId]: items })); }} onSnapshot={(accountId, snapshotMonth, amount) => runAction(() => addAccountSnapshot(db, householdId!, accountId, uid!, snapshotMonth, amount), "Monthly snapshot recorded.")} />}
                {section === "Transactions" && <TransactionsSection finance={finance} currency={currency} uid={uid ?? ""} memberNames={memberNames} month={month} filter={transactionFilter} setFilter={setTransactionFilter} typeFilter={transactionTypeFilter} setTypeFilter={setTransactionTypeFilter} onSave={async (input, existing) => runAction(async () => { const kind = input.type === "credit" ? "income" : input.purpose === "investment" ? "investment" : "expense"; if (!finance.categories.some((item) => item.name.toLowerCase() === input.category.trim().toLowerCase())) await saveCategory(db, householdId!, uid!, input.category, kind); await saveTransaction(db, householdId!, uid!, input, existing); }, "Transaction saved.")} onDelete={(id) => runAction(() => deleteTransaction(db, householdId!, id), "Transaction deleted.")} editing={editingTransaction} setEditing={setEditingTransaction} />}
                {section === "Budgets" && <BudgetsSection finance={finance} currency={currency} month={month} setMonth={setMonth} onSave={(input, existing) => runAction(() => saveBudget(db, householdId!, uid!, input, existing), "Budget saved.")} onDelete={(id) => runAction(() => deleteRecord(db, householdId!, "budgets", id), "Budget deleted.")} editing={editingBudget} setEditing={setEditingBudget} />}
                {section === "Goals" && <GoalsSection finance={finance} currency={currency} uid={uid ?? ""} memberNames={memberNames} onSave={(input, existing) => runAction(() => saveGoal(db, householdId!, uid!, input, existing), "Goal saved.")} onDelete={(id) => runAction(() => deleteRecord(db, householdId!, "goals", id), "Goal deleted.")} editing={editingGoal} setEditing={setEditingGoal} />}
                {section === "Assets & debts" && <ValuesSection finance={finance} currency={currency} uid={uid ?? ""} memberNames={memberNames} editing={editingValue} setEditing={setEditingValue} onSave={(group, input, existing) => runAction(() => saveManualValue(db, householdId!, uid!, group, input, existing), `${group === "assets" ? "Asset" : "Liability"} saved.`)} onDelete={(group, id) => runAction(() => deleteRecord(db, householdId!, group, id), "Record deleted.")} />}
                {section === "Household" && <HouseholdSection householdName={selectedHousehold?.householdName ?? ""} uid={uid ?? ""} isOwner={selectedHousehold?.role === "owner"} members={members} invitationCode={invitationCode} onInvite={handleCreateInvitation} onPromoteMember={handlePromoteMember} onTransferOwnership={handleTransferOwnership} updatingOwnership={transferringOwnership || promotingMember} />}
              </>
            )}
          </div>
        </section>
      </main>
    </AuthGuard>
  );
}

function LoadingPanel({ label }: { label: string }) {
  return <div role="status" className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600">{label}</div>;
}

function ErrorPanel({ message, onRetry }: { message: string; onRetry: () => void | Promise<void> }) {
  return <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-800"><p>{message}</p><button onClick={() => void onRetry()} className="mt-3 font-semibold underline">Retry</button></div>;
}

function MetricCard({ title, value, detail, accent = "emerald" }: { title: string; value: string; detail: string; accent?: string }) {
  const colors: Record<string, string> = { emerald: "bg-emerald-50 text-emerald-700", blue: "bg-blue-50 text-blue-700", amber: "bg-amber-50 text-amber-800", violet: "bg-violet-50 text-violet-700" };
  return <div className="rounded-2xl border border-slate-200 bg-white p-5"><p className="text-sm text-slate-500">{title}</p><p className="mt-3 text-2xl font-bold tracking-tight">{value}</p><p className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-xs ${colors[accent] ?? colors.emerald}`}>{detail}</p></div>;
}

function Overview({ finance, summary, month, setMonth, currency, memberNames, onOpen }: {
  finance: HouseholdFinanceData; summary: ReturnType<typeof calculateFinanceSummary>; month: string; setMonth: (month: string) => void; currency: string; memberNames: Map<string, string>; onOpen: (section: Section) => void;
}) {
  const monthTransactions = finance.transactions.filter((item) => item.date.startsWith(`${month}-`)).sort((a, b) => b.date.localeCompare(a.date));
  const budgets = finance.budgets.filter((budget) => budget.month === month);
  const activeAccounts = finance.accounts.filter((account) => !account.archived);
  return <>
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-bold">Financial snapshot</h2><p className="mt-1 text-sm text-slate-500">Household records in {currency}.</p></div><label className="text-sm text-slate-600">Reporting month <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} className="ml-2 rounded-lg border border-slate-200 bg-white px-3 py-2" /></label></div>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard title="Net worth" value={formatMoney(summary.netWorthMinor, currency)} detail={`${formatMoney(summary.assetsMinor, currency)} assets − ${formatMoney(summary.liabilitiesMinor, currency)} debts`} />
      <MetricCard title="Monthly income" value={formatMoney(summary.incomeMinor, currency)} detail="Income credits" accent="blue" />
      <MetricCard title="Ordinary expenses" value={formatMoney(summary.ordinaryExpensesMinor, currency)} detail="Excludes investment contributions" accent="amber" />
      <MetricCard title="Investment contributions" value={formatMoney(summary.investmentContributionsMinor, currency)} detail={`Available to plan: ${formatMoney(summary.availableToSpendMinor, currency)}`} accent="violet" />
    </div>
    <p className="-mt-3 text-xs text-slate-500">Available to spend is a transaction-based monthly planning figure, not an account balance. Investment contributions are shown separately and do not directly reduce net worth.</p>
    <div className="grid gap-6 xl:grid-cols-2">
      <section className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-center justify-between"><h2 className="font-bold">Accounts and other assets</h2><button onClick={() => onOpen("Accounts")} className="text-sm font-semibold text-emerald-700">Manage →</button></div><div className="mt-4 space-y-3">{activeAccounts.map((account) => <div key={account.id} className="flex justify-between gap-3 text-sm"><span>{account.name}<span className="ml-2 text-xs text-slate-500">{memberNames.get(account.ownerUid) ?? "Member"}</span></span><span className="font-semibold">{formatMoney(account.balanceMinor, currency)}</span></div>)}{finance.assets.map((asset) => <div key={asset.id} className="flex justify-between gap-3 text-sm"><span>{asset.name}<span className="ml-2 text-xs text-slate-500">Additional asset</span></span><span className="font-semibold">{formatMoney(asset.amountMinor, currency)}</span></div>)}{!activeAccounts.length && !finance.assets.length && <p className="text-sm text-slate-500">Add a manual account or asset to start your balance sheet.</p>}</div></section>
      <section className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-center justify-between"><h2 className="font-bold">Monthly budget alerts</h2><button onClick={() => onOpen("Budgets")} className="text-sm font-semibold text-emerald-700">Manage →</button></div><div className="mt-4 space-y-4">{budgets.map((budget) => { const progress = budgetProgress(budget, finance.transactions); return <div key={budget.id}><div className="flex justify-between gap-3 text-sm"><span>{budget.category}</span><span className={progress.overspent ? "font-semibold text-red-700" : "text-slate-600"}>{formatMoney(progress.spentMinor, currency)} / {formatMoney(budget.limitMinor, currency)}</span></div><div className="mt-2 h-2 overflow-hidden rounded bg-slate-100"><div className={`h-full ${progress.overspent ? "bg-red-500" : "bg-emerald-500"}`} style={{ width: `${Math.min(progress.percent, 100)}%` }} /></div>{progress.overspent && <p className="mt-1 text-xs font-medium text-red-700">Over budget by {formatMoney(-progress.remainingMinor, currency)}</p>}</div>; })}{!budgets.length && <p className="text-sm text-slate-500">No budgets set for this month.</p>}</div></section>
    </div>
    <div className="grid gap-6 xl:grid-cols-2">
      <section className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-center justify-between"><h2 className="font-bold">Recent transactions</h2><button onClick={() => onOpen("Transactions")} className="text-sm font-semibold text-emerald-700">View all →</button></div><div className="mt-4 divide-y divide-slate-100">{monthTransactions.slice(0, 5).map((item) => <div key={item.id} className="flex justify-between gap-3 py-3 text-sm"><div><p className="font-medium">{item.description || item.category}</p><p className="mt-1 text-xs text-slate-500">{item.date} · {item.category} · {memberNames.get(item.ownerUid) ?? "Member"}</p></div><p className={item.type === "credit" ? "font-semibold text-emerald-700" : "font-semibold"}>{item.type === "credit" ? "+" : "−"}{formatMoney(item.amountMinor, currency)}</p></div>)}{!monthTransactions.length && <p className="py-3 text-sm text-slate-500">No transactions this month.</p>}</div></section>
      <section className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-center justify-between"><h2 className="font-bold">Savings goals</h2><button onClick={() => onOpen("Goals")} className="text-sm font-semibold text-emerald-700">Manage →</button></div><div className="mt-4 space-y-4">{finance.goals.slice(0, 4).map((goal) => { const percent = Math.min(100, Math.round((goal.currentMinor / goal.targetMinor) * 100)); return <div key={goal.id}><div className="flex justify-between gap-3 text-sm"><span>{goal.name}</span><span className="text-slate-500">{percent}%</span></div><div className="mt-2 h-2 overflow-hidden rounded bg-slate-100"><div className="h-full bg-violet-500" style={{ width: `${percent}%` }} /></div><p className="mt-1 text-xs text-slate-500">{formatMoney(goal.currentMinor, currency)} of {formatMoney(goal.targetMinor, currency)}{goal.deadline ? ` · due ${goal.deadline}` : ""}</p></div>; })}{!finance.goals.length && <p className="text-sm text-slate-500">No savings goals yet.</p>}</div></section>
    </div>
    <p className="text-xs text-slate-500">Account balances are entered manually and are not changed by transactions. Additional assets should not duplicate an account balance; each liability should be entered once.</p>
  </>;
}

function AccountsSection({ finance, currency, uid, memberNames, onSave, onArchive, editing, setEditing, snapshots, loadSnapshots, onSnapshot }: {
  finance: HouseholdFinanceData; currency: string; uid: string; memberNames: Map<string, string>; onSave: (input: Pick<FinancialAccount, "name" | "kind" | "ownerUid" | "balanceMinor">, existing?: FinancialAccount) => Promise<void>; onArchive: (id: string) => Promise<void>; editing?: FinancialAccount; setEditing: (account?: FinancialAccount) => void; snapshots: Record<string, AccountSnapshot[]>; loadSnapshots: (id: string) => Promise<void>; onSnapshot: (id: string, month: string, amount: number) => Promise<void>;
}) {
  const [name, setName] = useState(""); const [kind, setKind] = useState<FinancialAccount["kind"]>("savings"); const [ownerUid, setOwnerUid] = useState(uid); const [balance, setBalance] = useState(""); const [snapshotMonth, setSnapshotMonth] = useState(""); const [snapshotAmount, setSnapshotAmount] = useState(""); const [snapshotAccount, setSnapshotAccount] = useState(""); const [error, setError] = useState("");
  useEffect(() => {
    // Current time is runtime data and must not be read during prerendering.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSnapshotMonth(currentMonthKey());
  }, []);
  // Reset controlled form fields when a different record is selected.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setName(editing?.name ?? ""); setKind(editing?.kind ?? "savings"); setOwnerUid(editing?.ownerUid ?? uid); setBalance(moneyInputValue(editing?.balanceMinor)); }, [editing, uid]);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setError(""); try { await onSave({ name: name.trim(), kind, ownerUid, balanceMinor: parseMoneyToMinorUnits(balance) }, editing); setEditing(undefined); setName(""); setBalance(""); } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save account."); } }
  async function snapshotSubmit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setError(""); try { await onSnapshot(snapshotAccount, snapshotMonth, parseMoneyToMinorUnits(snapshotAmount)); setSnapshotAmount(""); await loadSnapshots(snapshotAccount); } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not record snapshot."); } }
  return <div className="grid gap-6 xl:grid-cols-[1fr_1.2fr]"><section className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="font-bold">{editing ? "Edit account" : "Add an account"}</h2><p className="mt-1 text-xs text-slate-500">Balances are manual and denominated in {currency}.</p><form onSubmit={submit} className="mt-4 space-y-3"><input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="Account name" className={inputClass} /><select value={kind} onChange={(e) => setKind(e.target.value as FinancialAccount["kind"])} className={inputClass}><option value="savings">Personal Savings</option><option value="brokerage">Brokerage</option><option value="retirement">Retirement / 401(k)</option></select><select value={ownerUid} onChange={(e) => setOwnerUid(e.target.value)} className={inputClass}>{financeMemberOptions(memberNames, uid)}</select><input required inputMode="decimal" value={balance} onChange={(e) => setBalance(e.target.value)} placeholder="Balance (e.g. 1250.00)" className={inputClass} /><div className="flex gap-2"><button className={buttonClass}>{editing ? "Save account" : "Add account"}</button>{editing && <button type="button" onClick={() => setEditing(undefined)} className={secondaryButtonClass}>Cancel</button>}</div>{error && <p role="alert" className="text-sm text-red-700">{error}</p>}</form>
      <form onSubmit={snapshotSubmit} className="mt-8 border-t border-slate-100 pt-5"><h3 className="font-semibold">Record monthly balance snapshot</h3><div className="mt-3 grid gap-2 sm:grid-cols-2"><select required value={snapshotAccount} onChange={(e) => setSnapshotAccount(e.target.value)} className={inputClass}><option value="">Choose account</option>{finance.accounts.filter((item) => !item.archived).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><input required type="month" value={snapshotMonth} onChange={(e) => setSnapshotMonth(e.target.value)} className={inputClass} /><input required inputMode="decimal" value={snapshotAmount} onChange={(e) => setSnapshotAmount(e.target.value)} placeholder="Historical balance" className={inputClass} /><button disabled={!snapshotAccount} className={buttonClass}>Save snapshot</button></div></form>
    </section><section className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="font-bold">Household accounts</h2><div className="mt-4 space-y-3">{finance.accounts.map((account) => <div key={account.id} className="rounded-xl border border-slate-100 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-semibold">{account.name}</p><p className="mt-1 text-xs text-slate-500">{account.kind} · {memberNames.get(account.ownerUid) ?? "Member"}{account.archived ? " · archived" : ""}</p><p className="mt-2 text-xl font-bold">{formatMoney(account.balanceMinor, currency)}</p></div><div className="flex gap-2"><button onClick={() => setEditing(account)} className={secondaryButtonClass}>Edit</button>{!account.archived && <button onClick={() => void onArchive(account.id)} className={secondaryButtonClass}>Archive</button>}<button onClick={() => { setSnapshotAccount(account.id); void loadSnapshots(account.id); }} className={secondaryButtonClass}>History</button></div></div>{snapshots[account.id]?.length ? <div className="mt-3 border-t border-slate-100 pt-3 text-sm"><p className="mb-2 text-xs font-semibold uppercase text-slate-500">Monthly snapshots</p>{snapshots[account.id].map((snap) => <p key={snap.id} className="flex justify-between py-1"><span>{snap.month}</span><span>{formatMoney(snap.amountMinor, currency)}</span></p>)}</div> : null}</div>)}{!finance.accounts.length && <p className="text-sm text-slate-500">No accounts yet.</p>}</div></section></div>;
}

function financeMemberOptions(names: Map<string, string>, currentUid: string) {
  const entries = [...names.entries()];
  if (!entries.some(([id]) => id === currentUid)) entries.push([currentUid, "You"]);
  return entries.map(([id, name]) => <option key={id} value={id}>{name}</option>);
}

function TransactionsSection({ finance, currency, uid, memberNames, month, filter, setFilter, typeFilter, setTypeFilter, onSave, onDelete, editing, setEditing }: {
  finance: HouseholdFinanceData; currency: string; uid: string; memberNames: Map<string, string>; month: string; filter: string; setFilter: (value: string) => void; typeFilter: string; setTypeFilter: (value: string) => void; onSave: (input: Pick<FinancialTransaction, "type" | "purpose" | "category" | "description" | "amountMinor" | "date" | "accountId" | "ownerUid">, existing?: FinancialTransaction) => Promise<void>; onDelete: (id: string) => Promise<void>; editing?: FinancialTransaction; setEditing: (transaction?: FinancialTransaction) => void;
}) {
  const [type, setType] = useState<FinancialTransaction["type"]>("debit"); const [purpose, setPurpose] = useState<FinancialTransaction["purpose"]>("ordinary"); const [category, setCategory] = useState(""); const [description, setDescription] = useState(""); const [amount, setAmount] = useState(""); const [date, setDate] = useState(new Date().toISOString().slice(0, 10)); const [accountId, setAccountId] = useState(""); const [ownerUid, setOwnerUid] = useState(uid); const [error, setError] = useState("");
  // Reset controlled form fields when a different record is selected.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setType(editing?.type ?? "debit"); setPurpose(editing?.purpose ?? "ordinary"); setCategory(editing?.category ?? ""); setDescription(editing?.description ?? ""); setAmount(moneyInputValue(editing?.amountMinor)); setDate(editing?.date ?? new Date().toISOString().slice(0, 10)); setAccountId(editing?.accountId ?? ""); setOwnerUid(editing?.ownerUid ?? uid); }, [editing, uid]);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setError(""); try { await onSave({ type, purpose: type === "credit" ? "income" : purpose, category, description, amountMinor: parseMoneyToMinorUnits(amount), date, accountId: accountId || null, ownerUid }, editing); setEditing(undefined); setCategory(""); setDescription(""); setAmount(""); } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save transaction."); } }
  const rows = finance.transactions.filter((item) => item.date.startsWith(`${month}-`)
    && (typeFilter === "all" || item.type === typeFilter)
    && `${item.category} ${item.description}`.toLowerCase().includes(filter.toLowerCase()))
    .sort((a, b) => b.date.localeCompare(a.date));
  const categorySuggestions = finance.categories.filter((item) => type === "credit" ? item.kind === "income" : purpose === "investment" ? item.kind === "investment" : item.kind === "expense");
  return <div className="grid gap-6 xl:grid-cols-[1fr_1.3fr]"><section className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="font-bold">{editing ? "Edit transaction" : "Add a transaction"}</h2><p className="mt-1 text-xs text-slate-500">Adding a transaction never changes an account balance.</p><form onSubmit={submit} className="mt-4 space-y-3"><div className="grid grid-cols-2 gap-2"><select value={type} onChange={(e) => { const nextType = e.target.value as FinancialTransaction["type"]; setType(nextType); setPurpose(nextType === "credit" ? "income" : "ordinary"); }} className={inputClass}><option value="debit">Debit</option><option value="credit">Credit</option></select>{type === "debit" && <select value={purpose} onChange={(e) => setPurpose(e.target.value as FinancialTransaction["purpose"])} className={inputClass}><option value="ordinary">Ordinary expense</option><option value="investment">Investment contribution</option></select>}</div><input required list="category-options" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Category (choose or enter custom)" className={inputClass} /><datalist id="category-options">{categorySuggestions.map((item) => <option key={item.id} value={item.name} />)}</datalist><input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={240} placeholder="Description (optional)" className={inputClass} /><div className="grid grid-cols-2 gap-2"><input required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount" className={inputClass} /><input required type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} /></div><select value={accountId} onChange={(e) => setAccountId(e.target.value)} className={inputClass}><option value="">No linked account</option>{finance.accounts.filter((item) => !item.archived).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><select value={ownerUid} onChange={(e) => setOwnerUid(e.target.value)} className={inputClass}>{financeMemberOptions(memberNames, uid)}</select><div className="flex gap-2"><button className={buttonClass}>{editing ? "Save changes" : "Add transaction"}</button>{editing && <button type="button" onClick={() => setEditing(undefined)} className={secondaryButtonClass}>Cancel</button>}</div>{error && <p role="alert" className="text-sm text-red-700">{error}</p>}</form></section><section className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-bold">Transactions · {month}</h2><div className="flex gap-2"><input aria-label="Filter transactions" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter" className={`${inputClass} max-w-40`} /><select aria-label="Transaction type" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-2 text-sm"><option value="all">All</option><option value="credit">Credits</option><option value="debit">Debits</option></select></div></div><div className="mt-4 divide-y divide-slate-100">{rows.map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div><p className="font-semibold">{item.description || item.category}</p><p className="mt-1 text-xs text-slate-500">{item.date} · {item.category} · {item.purpose} · for {memberNames.get(item.ownerUid) ?? "Member"}</p></div><div className="flex items-center gap-2"><p className={item.type === "credit" ? "font-semibold text-emerald-700" : "font-semibold"}>{item.type === "credit" ? "+" : "−"}{formatMoney(item.amountMinor, currency)}</p><button onClick={() => setEditing(item)} className={secondaryButtonClass}>Edit</button><button onClick={() => void onDelete(item.id)} className={secondaryButtonClass}>Delete</button></div></div>)}{!rows.length && <p className="py-4 text-sm text-slate-500">No matching transactions.</p>}</div></section></div>;
}

function BudgetsSection({ finance, currency, month, setMonth, onSave, onDelete, editing, setEditing }: {
  finance: HouseholdFinanceData; currency: string; month: string; setMonth: (value: string) => void; onSave: (input: Pick<MonthlyBudget, "month" | "category" | "limitMinor">, existing?: MonthlyBudget) => Promise<void>; onDelete: (id: string) => Promise<void>; editing?: MonthlyBudget; setEditing: (item?: MonthlyBudget) => void;
}) {
  const [category, setCategory] = useState(""); const [limit, setLimit] = useState(""); const [error, setError] = useState("");
  // Reset controlled form fields when a different record is selected.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setCategory(editing?.category ?? ""); setLimit(moneyInputValue(editing?.limitMinor)); if (editing) setMonth(editing.month); }, [editing, setMonth]);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setError(""); try { await onSave({ month, category, limitMinor: parseMoneyToMinorUnits(limit) }, editing); setEditing(undefined); setCategory(""); setLimit(""); } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save budget."); } }
  const rows = finance.budgets.filter((item) => item.month === month);
  return <div className="grid gap-6 xl:grid-cols-[1fr_1.2fr]"><section className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="font-bold">{editing ? "Edit budget" : "Create a monthly budget"}</h2><form onSubmit={submit} className="mt-4 space-y-3"><input type="month" required value={month} onChange={(e) => setMonth(e.target.value)} className={inputClass} /><input required list="budget-categories" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Expense category" className={inputClass} /><datalist id="budget-categories">{finance.categories.filter((item) => item.kind === "expense").map((item) => <option key={item.id} value={item.name} />)}</datalist><input required inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} placeholder={`Monthly limit (${currency})`} className={inputClass} /><div className="flex gap-2"><button className={buttonClass}>{editing ? "Save budget" : "Add budget"}</button>{editing && <button type="button" onClick={() => setEditing(undefined)} className={secondaryButtonClass}>Cancel</button>}</div>{error && <p role="alert" className="text-sm text-red-700">{error}</p>}</form></section><section className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-center justify-between"><h2 className="font-bold">Budget progress</h2><input aria-label="Budget month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1 text-sm" /></div><div className="mt-5 space-y-5">{rows.map((budget) => { const progress = budgetProgress(budget, finance.transactions); return <div key={budget.id}><div className="flex justify-between gap-3 text-sm"><div><span className="font-medium">{budget.category}</span><p className="text-xs text-slate-500">{formatMoney(progress.remainingMinor, currency)} remaining</p></div><span className={progress.overspent ? "font-semibold text-red-700" : "text-slate-600"}>{formatMoney(progress.spentMinor, currency)} / {formatMoney(budget.limitMinor, currency)}</span></div><div className="mt-2 h-2 overflow-hidden rounded bg-slate-100"><div className={`h-full ${progress.overspent ? "bg-red-500" : "bg-emerald-500"}`} style={{ width: `${Math.min(progress.percent, 100)}%` }} /></div><div className="mt-2 flex justify-between text-xs"><span className={progress.overspent ? "font-semibold text-red-700" : "text-slate-500"}>{progress.overspent ? "Overspending alert" : `${progress.percent}% used`}</span><span><button onClick={() => setEditing(budget)} className="underline">Edit</button> · <button onClick={() => void onDelete(budget.id)} className="underline">Delete</button></span></div></div>; })}{!rows.length && <p className="text-sm text-slate-500">No budgets for {month}.</p>}</div></section></div>;
}

function GoalsSection({ finance, currency, uid, memberNames, onSave, onDelete, editing, setEditing }: {
  finance: HouseholdFinanceData; currency: string; uid: string; memberNames: Map<string, string>; onSave: (input: Pick<SavingsGoal, "name" | "targetMinor" | "currentMinor" | "deadline" | "ownerUid">, existing?: SavingsGoal) => Promise<void>; onDelete: (id: string) => Promise<void>; editing?: SavingsGoal; setEditing: (item?: SavingsGoal) => void;
}) {
  const [name, setName] = useState(""); const [target, setTarget] = useState(""); const [current, setCurrent] = useState("0"); const [deadline, setDeadline] = useState(""); const [ownerUid, setOwnerUid] = useState(uid); const [error, setError] = useState("");
  // Reset controlled form fields when a different record is selected.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setName(editing?.name ?? ""); setTarget(moneyInputValue(editing?.targetMinor)); setCurrent(moneyInputValue(editing?.currentMinor) || "0"); setDeadline(editing?.deadline ?? ""); setOwnerUid(editing?.ownerUid ?? uid); }, [editing, uid]);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setError(""); try { await onSave({ name, targetMinor: parseMoneyToMinorUnits(target), currentMinor: parseMoneyToMinorUnits(current), deadline: deadline || null, ownerUid }, editing); setEditing(undefined); setName(""); setTarget(""); setCurrent("0"); setDeadline(""); } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save goal."); } }
  return <div className="grid gap-6 xl:grid-cols-[1fr_1.2fr]"><section className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="font-bold">{editing ? "Edit goal" : "Create a savings goal"}</h2><form onSubmit={submit} className="mt-4 space-y-3"><input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="Goal name" className={inputClass} /><div className="grid grid-cols-2 gap-2"><input required inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} placeholder={`Target (${currency})`} className={inputClass} /><input required inputMode="decimal" value={current} onChange={(e) => setCurrent(e.target.value)} placeholder="Current progress" className={inputClass} /></div><input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} className={inputClass} /><select value={ownerUid} onChange={(e) => setOwnerUid(e.target.value)} className={inputClass}>{financeMemberOptions(memberNames, uid)}</select><div className="flex gap-2"><button className={buttonClass}>{editing ? "Save goal" : "Add goal"}</button>{editing && <button type="button" onClick={() => setEditing(undefined)} className={secondaryButtonClass}>Cancel</button>}</div>{error && <p role="alert" className="text-sm text-red-700">{error}</p>}</form></section><section className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="font-bold">Household goals</h2><div className="mt-4 space-y-4">{finance.goals.map((goal) => { const pct = Math.min(100, Math.round(goal.currentMinor / goal.targetMinor * 100)); return <div key={goal.id} className="rounded-xl border border-slate-100 p-4"><div className="flex justify-between"><div><p className="font-semibold">{goal.name}</p><p className="text-xs text-slate-500">{memberNames.get(goal.ownerUid) ?? "Member"}{goal.deadline ? ` · target ${goal.deadline}` : ""}</p></div><span className="text-sm font-semibold">{pct}%</span></div><div className="mt-3 h-2 rounded bg-slate-100"><div className="h-2 rounded bg-violet-500" style={{ width: `${pct}%` }} /></div><p className="mt-2 text-xs text-slate-600">{formatMoney(goal.currentMinor, currency)} / {formatMoney(goal.targetMinor, currency)}{goal.currentMinor >= goal.targetMinor ? " · Complete" : ""}</p><div className="mt-2 text-right text-xs"><button onClick={() => setEditing(goal)} className="underline">Edit</button> · <button onClick={() => void onDelete(goal.id)} className="underline">Delete</button></div></div>; })}{!finance.goals.length && <p className="text-sm text-slate-500">No goals yet.</p>}</div></section></div>;
}

function ValuesSection({ finance, currency, uid, memberNames, editing, setEditing, onSave, onDelete }: {
  finance: HouseholdFinanceData; currency: string; uid: string; memberNames: Map<string, string>; editing?: { group: "assets" | "liabilities"; record: ManualValueRecord }; setEditing: (item?: { group: "assets" | "liabilities"; record: ManualValueRecord }) => void; onSave: (group: "assets" | "liabilities", input: Pick<ManualValueRecord, "name" | "amountMinor" | "ownerUid">, record?: ManualValueRecord) => Promise<void>; onDelete: (group: "assets" | "liabilities", id: string) => Promise<void>;
}) {
  const [group, setGroup] = useState<"assets" | "liabilities">("assets"); const [name, setName] = useState(""); const [amount, setAmount] = useState(""); const [ownerUid, setOwnerUid] = useState(uid); const [error, setError] = useState("");
  // Reset controlled form fields when a different record is selected.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setGroup(editing?.group ?? "assets"); setName(editing?.record.name ?? ""); setAmount(moneyInputValue(editing?.record.amountMinor)); setOwnerUid(editing?.record.ownerUid ?? uid); }, [editing, uid]);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setError(""); try { await onSave(group, { name, amountMinor: parseMoneyToMinorUnits(amount), ownerUid }, editing?.record); setEditing(undefined); setName(""); setAmount(""); } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save value."); } }
  return <div className="grid gap-6 xl:grid-cols-[1fr_1.2fr]"><section className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="font-bold">{editing ? "Edit record" : "Add an asset or debt"}</h2><p className="mt-1 text-xs text-slate-500">Do not enter an account balance again here. Enter each liability once.</p><form onSubmit={submit} className="mt-4 space-y-3"><select disabled={Boolean(editing)} value={group} onChange={(e) => setGroup(e.target.value as typeof group)} className={inputClass}><option value="assets">Additional asset</option><option value="liabilities">Outstanding debt</option></select><input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder={group === "assets" ? "Asset name" : "Debt name"} className={inputClass} /><input required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={`Amount (${currency})`} className={inputClass} /><select value={ownerUid} onChange={(e) => setOwnerUid(e.target.value)} className={inputClass}>{financeMemberOptions(memberNames, uid)}</select><div className="flex gap-2"><button className={buttonClass}>{editing ? "Save record" : "Add record"}</button>{editing && <button type="button" onClick={() => setEditing(undefined)} className={secondaryButtonClass}>Cancel</button>}</div>{error && <p role="alert" className="text-sm text-red-700">{error}</p>}</form></section><div className="grid gap-6"><ValueList title="Additional assets" records={finance.assets} currency={currency} memberNames={memberNames} group="assets" onEdit={(item) => setEditing({ group: "assets", record: item })} onDelete={onDelete} /><ValueList title="Outstanding debts" records={finance.liabilities} currency={currency} memberNames={memberNames} group="liabilities" onEdit={(item) => setEditing({ group: "liabilities", record: item })} onDelete={onDelete} /></div></div>;
}

function ValueList({ title, records, currency, memberNames, group, onEdit, onDelete }: { title: string; records: ManualValueRecord[]; currency: string; memberNames: Map<string, string>; group: "assets" | "liabilities"; onEdit: (item: ManualValueRecord) => void; onDelete: (group: "assets" | "liabilities", id: string) => Promise<void> }) {
  return <section className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="font-bold">{title}</h2><div className="mt-3 divide-y divide-slate-100">{records.map((item) => <div key={item.id} className="flex items-center justify-between gap-3 py-3 text-sm"><div><p className="font-medium">{item.name}</p><p className="text-xs text-slate-500">{memberNames.get(item.ownerUid) ?? "Member"}</p></div><div className="flex items-center gap-2"><span className="font-semibold">{formatMoney(item.amountMinor, currency)}</span><button onClick={() => onEdit(item)} className="underline">Edit</button><button onClick={() => void onDelete(group, item.id)} className="underline">Delete</button></div></div>)}{!records.length && <p className="py-2 text-sm text-slate-500">None entered.</p>}</div></section>;
}

function HouseholdSection({ householdName, uid, isOwner, members, invitationCode, onInvite, onPromoteMember, onTransferOwnership, updatingOwnership }: {
  householdName: string;
  uid: string;
  isOwner: boolean;
  members: HouseholdMember[];
  invitationCode: string;
  onInvite: (event: FormEvent<HTMLFormElement>) => void;
  onPromoteMember: (memberUid: string, memberName: string) => Promise<void>;
  onTransferOwnership: (memberUid: string, memberName: string) => Promise<void>;
  updatingOwnership: boolean;
}) {
  const [copied, setCopied] = useState(false);
  async function copyCode() { try { await navigator.clipboard.writeText(invitationCode); setCopied(true); } catch { setCopied(false); } }
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="font-bold">{householdName}</h2>
        <p className="mt-2 text-sm text-slate-600">Household data is shared with every active member. Each record also tracks its creator and, where relevant, its owner.</p>
        <p className="mt-4 text-xs text-slate-500">Your account ID</p>
        <p className="mt-1 break-all rounded-lg bg-slate-50 p-3 font-mono text-sm">{uid}</p>
        <h3 className="mt-6 font-semibold">Members</h3>
        <div className="mt-3 space-y-2">
          {members.map((member) => {
            const memberName = member.displayName || member.email || member.uid;
            return (
              <div key={member.uid} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-100 p-3">
                <div>
                  <p className="font-medium">{memberName} {member.uid === uid ? "(you)" : ""}</p>
                  <p className="mt-1 break-all text-xs text-slate-500">{member.role} · {member.uid}</p>
                </div>
                {isOwner && member.uid !== uid && member.role === "member" && (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={updatingOwnership}
                      onClick={() => void onPromoteMember(member.uid, memberName)}
                      className={`${secondaryButtonClass} disabled:opacity-60`}
                    >
                      {updatingOwnership ? "Updating…" : "Promote to owner"}
                    </button>
                    <button
                      type="button"
                      disabled={updatingOwnership}
                      onClick={() => void onTransferOwnership(member.uid, memberName)}
                      className={`${secondaryButtonClass} disabled:opacity-60`}
                    >
                      Transfer ownership
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {isOwner && members.some((member) => member.uid !== uid && member.role === "member") && (
          <p className="mt-3 text-xs text-slate-500">Promoting a member makes you both owners. Transfer ownership only if you want to become a regular member.</p>
        )}
      </section>
      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="font-bold">Invite a household member</h2>
        <p className="mt-2 text-sm text-slate-600">Create a private {INVITATION_CODE_LENGTH}-character invitation code and share it directly with the new member. They need an account, but their email does not need to be verified. The code expires after {INVITATION_LIFETIME_DAYS} days and works once, so share it securely.</p>
        {isOwner ? <form onSubmit={onInvite} className="mt-4 space-y-3"><button className={buttonClass}>Create invitation code</button></form> : <p className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">Only the household owner can create invitations.</p>}
        {invitationCode && <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4"><p className="text-sm font-semibold text-emerald-900">Share this private invitation code</p><code className="mt-2 block break-all font-mono text-xl font-bold">{invitationCode}</code><button onClick={() => void copyCode()} className={`${secondaryButtonClass} mt-3`}>{copied ? "Copied" : "Copy code"}</button></div>}
      </section>
    </div>
  );
}
