"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
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
  addGoalProgress,
  BUDGET_CATEGORIES,
  budgetProgress,
  copyPreviousMonthBudgets,
  currentMonthKey,
  deleteRecord,
  deleteAccount,
  deleteRecurringPayment,
  deleteTransaction,
  calculateFinanceSummary,
  formatMoney,
  goalProgressPercent,
  getAccountSnapshots,
  isMonthKey,
  loadHouseholdFinance,
  parseMoneyToMinorUnits,
  previousMonthKey,
  saveAccount,
  saveBudget,
  saveGoal,
  saveManualValue,
  saveRecurringPayment,
  saveTransaction,
  SAVINGS_CATEGORY,
  TRANSACTION_CATEGORIES,
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
  RecurringPayment,
} from "@/lib/types";

type Section = "Dashboard" | "Transactions" | "Budgets" | "Goals" | "Investments" | "Household";
type AppNotification = {
  id: number;
  message: string;
  type: "success" | "error";
  createdAt: number;
};
type CelebrationKind = "goal" | "budget" | "income" | "transfer";
type Celebration = { id: number; kind: CelebrationKind };
const sections: Section[] = ["Dashboard", "Transactions", "Budgets", "Goals", "Investments", "Household"];
const inputClass = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-600";
const buttonClass = "rounded-lg bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-60";
const secondaryButtonClass = "rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium hover:border-teal-200 hover:bg-teal-50 hover:text-teal-800";

const emptyFinance: HouseholdFinanceData = {
  accounts: [], categories: [], transactions: [], budgets: [], goals: [], assets: [], liabilities: [], recurringPayments: [],
};

function moneyInputValue(minor?: number) {
  return minor === undefined ? "" : (minor / 100).toFixed(2);
}

function focusEditTarget(element: HTMLElement | null) {
  if (!element) return;
  element.scrollIntoView({ behavior: "smooth", block: "center" });
  element.classList.remove("edit-focus-highlight");
  void element.offsetWidth;
  element.classList.add("edit-focus-highlight");
  window.setTimeout(() => element.classList.remove("edit-focus-highlight"), 2400);
  element.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
    "input:not([type=hidden]), select, textarea",
  )?.focus({ preventScroll: true });
}

function useEditFocus<T extends HTMLElement>(targetKey: boolean | string | undefined) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!targetKey) return;
    const frame = requestAnimationFrame(() => focusEditTarget(ref.current));
    return () => cancelAnimationFrame(frame);
  }, [targetKey]);
  return ref;
}

export default function Home() {
  const router = useRouter();
  const { uid, households, activeHouseholdId, loading: householdsLoading, error: householdError, retry, selectHousehold } = useHouseholds();
  const [section, setSection] = useState<Section>("Dashboard");
  const [finance, setFinance] = useState<HouseholdFinanceData>(emptyFinance);
  const [members, setMembers] = useState<HouseholdMember[]>([]);
  const [loadingFinance, setLoadingFinance] = useState(false);
  const [financeError, setFinanceError] = useState("");
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [toast, setToast] = useState<AppNotification>();
  const [celebration, setCelebration] = useState<Celebration>();
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [showNotifications, setShowNotifications] = useState(false);
  const notificationSequence = useRef(0);
  const celebrationSequence = useRef(0);
  const [signOutError, setSignOutError] = useState("");
  const [signingOut, setSigningOut] = useState(false);
  const [month, setMonth] = useState("");
  const [transactionFilter, setTransactionFilter] = useState("");
  const [transactionTypeFilter, setTransactionTypeFilter] = useState("all");
  const [editingAccount, setEditingAccount] = useState<FinancialAccount | undefined>();
  const [editingTransaction, setEditingTransaction] = useState<FinancialTransaction | undefined>();
  const [editingBudget, setEditingBudget] = useState<MonthlyBudget | undefined>();
  const [editingGoal, setEditingGoal] = useState<SavingsGoal | undefined>();
  const [snapshotHistory, setSnapshotHistory] = useState<Record<string, AccountSnapshot[]>>({});
  const [invitation, setInvitation] = useState<{ code: string; uid: string; householdId: string } | null>(null);
  const [editingHouseholdName, setEditingHouseholdName] = useState(false);
  const [householdNameDraft, setHouseholdNameDraft] = useState("");
  const [savingHouseholdName, setSavingHouseholdName] = useState(false);
  const [householdNameError, setHouseholdNameError] = useState("");
  const [transferringOwnership, setTransferringOwnership] = useState(false);
  const [promotingMember, setPromotingMember] = useState(false);
  const [darkMode, setDarkMode] = useState(false);

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

  function addNotification(message: string, type: AppNotification["type"] = "success") {
    const notification = {
      id: ++notificationSequence.current,
      message,
      type,
      createdAt: Date.now(),
    };
    setToast(notification);
    setNotifications((current) => [notification, ...current].slice(0, 20));
    setUnreadNotifications((current) => current + 1);
  }

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(undefined), 5000);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    if (!celebration) return;
    const timeout = window.setTimeout(() => setCelebration(undefined), 2800);
    return () => window.clearTimeout(timeout);
  }, [celebration]);

  const refresh = useCallback(async () => {
    if (!householdId) return;
    setLoadingFinance(true);
    setFinanceError("");
    try {
      const [nextFinance, nextMembers] = await Promise.all([
        loadHouseholdFinance(db, householdId),
        getHouseholdMembers(db, householdId),
      ]);
      const nextSnapshotHistory = Object.fromEntries(await Promise.all(nextFinance.accounts
        .filter((account) => !account.archived)
        .map(async (account) => [account.id, await getAccountSnapshots(db, householdId, account.id)] as const)));
      setFinance(nextFinance);
      setMembers(nextMembers);
      setSnapshotHistory(nextSnapshotHistory);
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
    const savedTheme = window.localStorage.getItem("household-hq-theme");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDarkMode(savedTheme === "dark");
  }, []);

  function toggleTheme() {
    setDarkMode((current) => {
      const next = !current;
      window.localStorage.setItem("household-hq-theme", next ? "dark" : "light");
      return next;
    });
  }

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
    setSnapshotHistory({});
    if (householdId) void refresh();
  }, [householdId, refresh]);

  useEffect(() => {
    // Invitation codes are private UI state scoped to their creator.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setInvitation(null);
  }, [uid]);

  async function runAction(
    action: () => Promise<unknown>,
    successMessage = "Saved.",
    onSuccess?: () => void,
    celebrationKind?: CelebrationKind,
  ) {
    setFinanceError("");
    try {
      await action();
      addNotification(successMessage);
      await refresh();
      onSuccess?.();
      if (celebrationKind) {
        setCelebration({ id: ++celebrationSequence.current, kind: celebrationKind });
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "The change could not be saved.";
      setFinanceError(message);
      addNotification(message, "error");
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
    requestAnimationFrame(() => focusEditTarget(document.getElementById("household-name-editor")));
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
      addNotification(`${newOwnerName} is now the household owner. You are now a member.`);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Could not transfer household ownership.";
      setFinanceError(message);
      addNotification(message, "error");
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
      addNotification(`${memberName} is now an owner. You remain an owner.`);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Could not promote the household member.";
      setFinanceError(message);
      addNotification(message, "error");
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
      addNotification(`Invitation created. It expires in ${INVITATION_LIFETIME_DAYS} days.`);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Could not create invitation.";
      setFinanceError(message);
      addNotification(message, "error");
    }
  }

  if (householdsLoading) {
    return <AuthGuard><LoadingPanel label="Loading your household…" /></AuthGuard>;
  }

  if (householdError) {
    return <AuthGuard><main className="min-h-screen bg-[#f3f7f5] p-8"><ErrorPanel message={householdError} onRetry={retry} /></main></AuthGuard>;
  }

  if (households.length > 1 && !selectedHousehold) {
    return (
      <AuthGuard>
        <main className="min-h-screen bg-[#f3f7f5] p-5 text-slate-900 sm:p-8">
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
      <main className={`app-shell min-h-screen bg-[#f3f7f5] text-slate-900 md:flex ${darkMode ? "app-dark" : ""}`}>
        <aside className="flex w-full shrink-0 flex-col border-b border-slate-200 bg-white md:min-h-screen md:w-64 md:border-b-0 md:border-r">
          <Link href="/" aria-label="HouseholdHQ dashboard home" className="flex items-center gap-3 px-6 py-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"><Image src="/householdhq-icon.svg" alt="" width={40} height={40} priority className="h-10 w-10 shrink-0 rounded-xl object-contain" /><div><p className="text-lg font-bold tracking-tight">HouseholdHQ</p><p className="text-xs text-slate-500">Your money, together.</p></div></Link>
            <div className="px-4 pb-4">
              <div className="household-info-card w-full max-w-sm rounded-2xl border border-slate-200 bg-white/80 p-4 shadow-sm backdrop-blur-xl">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Household</p>
                {editingHouseholdName ? <form id="household-name-editor" onSubmit={handleRenameHousehold} className="edit-focus-target mt-2 space-y-2"><input autoFocus required maxLength={80} aria-label="Household name" value={householdNameDraft} onChange={(event) => setHouseholdNameDraft(event.target.value)} className={inputClass} /><div className="flex gap-2"><button disabled={savingHouseholdName} className={`${buttonClass} px-3 py-2`}>{savingHouseholdName ? "Saving…" : "Save"}</button><button type="button" disabled={savingHouseholdName} onClick={() => { setEditingHouseholdName(false); setHouseholdNameError(""); }} className={secondaryButtonClass}>Cancel</button></div>{householdNameError && <p role="alert" className="text-xs text-red-700">{householdNameError}</p>}</form> : <div className="mt-1 flex items-center gap-2">{households.length > 1 ? <select aria-label="Active household" value={householdId} onChange={(event) => selectHousehold(event.target.value)} className="min-w-0 flex-1 bg-transparent font-semibold">{households.map((item) => <option key={item.householdId} value={item.householdId}>{item.householdName}</option>)}</select> : <p className="min-w-0 flex-1 truncate font-semibold">{selectedHousehold?.householdName}</p>}{selectedHousehold?.role === "owner" && <button type="button" aria-label={`Edit ${selectedHousehold.householdName}`} title={`Edit ${selectedHousehold.householdName}`} onClick={startEditingHouseholdName} className="rounded-md px-2 py-1 text-sm text-slate-500 hover:bg-slate-50 hover:text-emerald-800">Edit</button>}</div>}
                <p className="mt-1 text-xs text-slate-500">{members.length} members · {currency}</p>
              </div>
            </div>


          <div className="mt-auto hidden p-4 md:block"><div className="rounded-xl bg-slate-900 p-4 text-white"><p className="text-sm font-semibold">Your finances, together</p><p className="mt-1 text-xs leading-5 text-slate-300">Balances are entered manually. Transactions help you plan; they never change account balances.</p></div><p className="mt-4 text-xs text-slate-400">HouseholdHQ · Shared workspace</p></div>
        </aside>

        <section className="min-w-0 flex-1">
          <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4 sm:px-8">
            <div><p className="text-sm text-slate-500">{selectedHousehold?.householdName}</p><h1 className="mt-1 text-xl font-bold tracking-tight">{section === "Dashboard" ? "Dashboard" : section}</h1></div>
            <div className="flex items-center gap-2">
              {signOutError && <span role="alert" className="text-sm text-red-700">{signOutError}</span>}
              <div className="relative">
                <button
                  type="button"
                  aria-label={`Notifications${unreadNotifications ? `, ${unreadNotifications} unread` : ""}`}
                  aria-expanded={showNotifications}
                  aria-haspopup="true"
                  onClick={() => {
                    setShowNotifications((open) => !open);
                    setUnreadNotifications(0);
                  }}
                  title="Notifications"
                  className="relative inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
                    <path d="M10 21h4" />
                  </svg>
                  {unreadNotifications > 0 && <span className="absolute -right-1 -top-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">{unreadNotifications > 9 ? "9+" : unreadNotifications}</span>}
                </button>
                {showNotifications && <div role="dialog" aria-label="Notifications" className="absolute right-0 z-40 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-slate-200 bg-white p-4 text-slate-900 shadow-xl">
                  <div className="flex items-center justify-between">
                    <h2 className="font-bold">Notifications</h2>
                    <button type="button" onClick={() => setShowNotifications(false)} aria-label="Close notifications" className="rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100">×</button>
                  </div>
                  {notifications.length ? <>
                    <ul className="mt-3 max-h-80 space-y-2 overflow-y-auto">
                      {notifications.map((notification) => <li key={notification.id} className={`rounded-lg p-3 text-sm ${notification.type === "error" ? "bg-red-50 text-red-800" : "bg-emerald-50 text-emerald-900"}`}>
                        <p>{notification.message}</p>
                        <time className="mt-1 block text-xs opacity-70" dateTime={new Date(notification.createdAt).toISOString()}>{new Date(notification.createdAt).toLocaleString()}</time>
                      </li>)}
                    </ul>
                    <button type="button" onClick={() => setNotifications([])} className="mt-3 text-xs font-semibold text-slate-500 underline">Clear notifications</button>
                  </> : <p className="mt-3 text-sm text-slate-500">You’re all caught up.</p>}
                </div>}
              </div>
              <button
                type="button"
                aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"}
                aria-pressed={darkMode}
                title={darkMode ? "Switch to light mode" : "Switch to dark mode"}
                onClick={toggleTheme}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
              >
                {darkMode
                  ? <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" /></svg>
                  : <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z" /></svg>}
              </button>
              <button
                type="button"
                aria-label={signingOut ? "Signing out" : "Sign out"}
                title={signingOut ? "Signing out" : "Sign out"}
                disabled={signingOut}
                onClick={handleSignOut}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:bg-red-50 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 disabled:opacity-60"
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10 17l5-5-5-5M15 12H3" />
                  <path d="M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6" />
                </svg>
              </button>
            </div>
          </header>
          <nav aria-label="Workspace" className="glass-nav mx-auto my-4 flex w-fit max-w-[calc(100%-2rem)] gap-1 overflow-x-auto rounded-full p-1.5">
            {sections.map((item) => {
              const active = section === item;
              return (
                <button
                  key={item}
                  type="button"
                  aria-current={active ? "page" : undefined}
                  onClick={() => setSection(item)}
                  className={`glass-nav-item group inline-flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2 ${active ? "glass-nav-active" : "glass-nav-idle"}`}
                >
                  <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full transition-colors duration-200 ${active ? "bg-teal-100 text-teal-800" : "bg-slate-100/80 text-slate-500 group-hover:bg-teal-50 group-hover:text-teal-700"}`}>
                    <WorkspaceIcon section={item} />
                  </span>
                  <span>{item}</span>
                </button>
              );
            })}
          </nav>
          <div className="mx-auto max-w-7xl space-y-6 p-5 sm:p-8">
            {financeError && <ErrorPanel message={financeError} onRetry={refresh} />}
            {loadingFinance ? <LoadingPanel label="Loading household records…" /> : (
              <>
                {section === "Dashboard" && <Dashboard finance={finance} month={month} setMonth={setMonth} currency={currency} memberNames={memberNames} onOpen={setSection} onAddPayment={(input) => runAction(() => saveRecurringPayment(db, householdId!, uid!, input), "Recurring payment added.")} onDeletePayment={(id) => runAction(() => deleteRecurringPayment(db, householdId!, id), "Recurring payment removed.")} />}
                {section === "Transactions" && <TransactionsSection finance={finance} currency={currency} uid={uid ?? ""} memberNames={memberNames} filter={transactionFilter} setFilter={setTransactionFilter} typeFilter={transactionTypeFilter} setTypeFilter={setTransactionTypeFilter} onSave={(input, existing) => runAction(() => saveTransaction(db, householdId!, uid!, input, existing), "Transaction saved.", undefined, existing ? undefined : input.type === "credit" ? "income" : input.type === "transfer" ? "transfer" : undefined)} onDelete={(id) => runAction(() => deleteTransaction(db, householdId!, id), "Transaction deleted.")} editing={editingTransaction} setEditing={setEditingTransaction} />}
                {section === "Budgets" && <BudgetsSection finance={finance} currency={currency} month={month} setMonth={setMonth} onSave={(input, existing) => runAction(() => saveBudget(db, householdId!, uid!, input, existing), "Budget saved.", undefined, existing ? undefined : "budget")} onCopyPrevious={(sourceMonth, targetMonth) => runAction(() => copyPreviousMonthBudgets(db, householdId!, uid!, sourceMonth, targetMonth, finance.budgets), "Previous month’s budgets copied into the selected month.")} onDelete={(id) => runAction(() => deleteRecord(db, householdId!, "budgets", id), "Budget deleted.")} editing={editingBudget} setEditing={setEditingBudget} />}
                {section === "Goals" && <GoalsSection finance={finance} currency={currency} uid={uid ?? ""} memberNames={memberNames} onSave={(input, existing) => runAction(() => saveGoal(db, householdId!, uid!, input, existing), "Goal saved.", undefined, !existing && input.currentMinor >= input.targetMinor ? "goal" : undefined)} onAddProgress={(goalId, amountMinor, onSuccess) => {
                  const goal = finance.goals.find((item) => item.id === goalId);
                  const completesGoal = Boolean(goal && goal.currentMinor < goal.targetMinor && goal.currentMinor + amountMinor >= goal.targetMinor);
                  return runAction(() => addGoalProgress(db, householdId!, goalId, amountMinor), completesGoal ? "Goal achieved — congratulations!" : "Goal progress updated.", onSuccess, completesGoal ? "goal" : undefined);
                }} onDelete={(id) => runAction(() => deleteRecord(db, householdId!, "goals", id), "Goal deleted.")} editing={editingGoal} setEditing={setEditingGoal} />}
                {section === "Investments" && <InvestmentsSection finance={finance} currency={currency} uid={uid ?? ""} memberNames={memberNames} editing={editingAccount} setEditing={setEditingAccount} snapshots={snapshotHistory} onSaveAccount={(input, existing) => runAction(async () => { const accountId = await saveAccount(db, householdId!, uid!, currency, input, existing); const thisMonth = currentMonthKey(); if (!(snapshotHistory[accountId] ?? []).some((snapshot) => snapshot.month === thisMonth)) await addAccountSnapshot(db, householdId!, accountId, uid!, thisMonth, input.balanceMinor); }, "Account balance saved.")} onDeleteAccount={(id) => runAction(() => deleteAccount(db, householdId!, id), "Account and its snapshots deleted.")} onSnapshot={(accountId, snapshotMonth, amount) => runAction(() => addAccountSnapshot(db, householdId!, accountId, uid!, snapshotMonth, amount), "Monthly snapshot recorded.")} onSaveManualValue={(group, input, existing) => runAction(() => saveManualValue(db, householdId!, uid!, group, input, existing), `${group === "assets" ? "Asset" : "Liability"} saved.`)} onDeleteManualValue={(group, id) => runAction(() => deleteRecord(db, householdId!, group, id), `${group === "assets" ? "Asset" : "Liability"} deleted.`)} />}
                {section === "Household" && <HouseholdSection householdName={selectedHousehold?.householdName ?? ""} uid={uid ?? ""} isOwner={selectedHousehold?.role === "owner"} members={members} invitationCode={invitationCode} onInvite={handleCreateInvitation} onPromoteMember={handlePromoteMember} onTransferOwnership={handleTransferOwnership} updatingOwnership={transferringOwnership || promotingMember} />}
              </>
            )}

          </div>
        </section>
        {toast && <div key={toast.id} role={toast.type === "error" ? "alert" : "status"} aria-live={toast.type === "error" ? "assertive" : "polite"} className={`notification-toast fixed right-4 top-4 z-50 flex w-[min(24rem,calc(100vw-2rem))] items-start gap-3 rounded-xl border p-4 shadow-xl ${toast.type === "error" ? "border-red-200 bg-white text-red-900" : "border-emerald-200 bg-white text-emerald-900"}`}><span aria-hidden="true" className={`mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${toast.type === "error" ? "bg-red-600" : "bg-emerald-600"}`}>{toast.type === "error" ? "!" : "✓"}</span><p className="flex-1 text-sm font-medium">{toast.message}</p><button type="button" onClick={() => setToast(undefined)} aria-label="Dismiss notification" className="rounded-md px-1 text-lg leading-none text-slate-400 hover:bg-slate-100 hover:text-slate-700">×</button></div>}
        {celebration && <CelebrationEffect key={celebration.id} kind={celebration.kind} />}
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

function CelebrationEffect({ kind }: { kind: CelebrationKind }) {
  const details = {
    goal: { title: "Goal achieved!", message: "You made it happen.", icon: <><path d="m12 3 2.5 5.1 5.6.8-4.1 4 .97 5.6L12 15.9l-5 2.6.96-5.6-4.06-4 5.6-.8L12 3Z" /><path d="m9.5 11.8 1.7 1.7 3.5-3.8" /></> },
    budget: { title: "Budget created", message: "Your plan is taking shape.", icon: <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4m8-4v4M4 10h16m-9 4 2 2 4-4" /></> },
    income: { title: "Income added", message: "Nice work keeping things up to date.", icon: <><path d="M12 19V5m-6 6 6-6 6 6" /><path d="M4 20h16" /></> },
    transfer: { title: "Transfer recorded", message: "Your money movement is tracked.", icon: <><path d="M7 7h13l-3-3m3 3-3 3M17 17H4l3 3m-3-3 3-3" /></> },
  }[kind];

  return (
    <div className="celebration-layer" role="status" aria-live="polite">
      {kind === "goal" && <div aria-hidden="true" className="celebration-confetti-field">
        {Array.from({ length: 28 }, (_, index) => <span key={index} className={`celebration-confetti confetti-${index % 14}`} />)}
      </div>}
      <div className={`celebration-card celebration-card-${kind}`}>
        <span aria-hidden="true" className="celebration-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{details.icon}</svg>
        </span>
        <span><strong className="block text-sm">{details.title}</strong><span className="mt-0.5 block text-xs opacity-75">{details.message}</span></span>
      </div>
    </div>
  );
}

function WorkspaceIcon({ section }: { section: Section }) {
  const icon = {
    Dashboard: <><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" /></>,
    Transactions: <><path d="M6 3.5h9l3 3V20a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 6 20z" /><path d="M14.5 3.5V7H18M9 11h6M9 15h6" /></>,
    Budgets: <><path d="M4 7.5h15a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h13" /><path d="M15 12h6v4h-6a2 2 0 0 1 0-4Z" /><circle cx="16" cy="14" r=".5" fill="currentColor" stroke="none" /></>,
    Goals: <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="1" /></>,
    Investments: <><path d="M4 19V5M4 19h16" /><path d="m7 15 4-4 3 2 5-6" /><path d="M16 7h3v3" /></>,
    Household: <><path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="10" cy="7" r="4" /><path d="M20 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
  }[section];

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 transition-transform duration-200 group-hover:scale-110">
      {icon}
    </svg>
  );
}

function InvestmentKindIcon({ kind }: { kind: FinancialAccount["kind"] }) {
  const icon = kind === "savings"
    ? <><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M3 10h18M7 15h3" /><circle cx="16.5" cy="14.5" r="1.5" /></>
    : kind === "retirement"
      ? <><circle cx="12" cy="12" r="9" /><path d="M12 3v9h9M12 12l6.4 6.4" /></>
      : <><path d="M4 19V5M4 19h16" /><path d="m7 15 4-4 3 2 5-6" /></>;

  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">{icon}</svg>;
}

function FeatureHeading({ section, title, description }: { section: Section; title: string; description: string }) {
  return (
    <div className="mb-5 flex items-center gap-3">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-teal-50 text-teal-800 ring-1 ring-teal-100 transition duration-200 hover:-rotate-3 hover:scale-105">
        <WorkspaceIcon section={section} />
      </span>
      <div>
        <h2 className="text-lg font-bold tracking-tight">{title}</h2>
        <p className="mt-0.5 text-sm text-slate-500">{description}</p>
      </div>
    </div>
  );
}

function MetricIcon({ name }: { name: "netWorth" | "income" | "expenses" | "saved" }) {
  const paths = {
    netWorth: <><path d="M3 17 9 11l4 4 8-9" /><path d="M15 6h6v6" /><path d="M4 21h16" /></>,
    income: <><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></>,
    expenses: <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h4" /></>,
    saved: <><path d="M4 12a8 8 0 1 0 2.3-5.7L4 8" /><path d="M4 4v4h4" /><path d="M12 8v4l3 2" /></>,
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">{paths[name]}</svg>;
}

function MetricCard({ title, value, detail, accent = "emerald", note, icon, extra }: { title: string; value: string; detail: string; accent?: string; note?: string; icon: "netWorth" | "income" | "expenses" | "saved"; extra?: ReactNode }) {
  const colors: Record<string, string> = { emerald: "bg-emerald-50 text-emerald-700 ring-emerald-100", blue: "bg-sky-50 text-sky-700 ring-sky-100", amber: "bg-orange-50 text-orange-800 ring-orange-100", violet: "bg-violet-50 text-violet-700 ring-violet-100" };
  return <article className="group flex h-full min-h-[190px] flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md motion-reduce:transition-none"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-medium text-slate-500">{title}</p><p className="mt-3 text-2xl font-bold tracking-tight text-slate-900">{value}</p></div><span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 transition-transform duration-200 group-hover:scale-105 motion-reduce:transition-none ${colors[accent] ?? colors.emerald}`}><MetricIcon name={icon} /></span></div><p className={`mt-3 inline-flex w-fit rounded-full px-2.5 py-1 text-xs font-medium ${colors[accent] ?? colors.emerald}`}>{detail}</p>{note && <p className="mt-2 text-xs leading-5 text-slate-500">{note}</p>}{extra && <div className="mt-auto pt-3">{extra}</div>}</article>;
}

function Dashboard({ finance, month, setMonth, currency, memberNames, onOpen, onAddPayment, onDeletePayment }: {
  finance: HouseholdFinanceData; month: string; setMonth: (month: string) => void; currency: string; memberNames: Map<string, string>; onOpen: (section: Section) => void; onAddPayment: (input: Pick<RecurringPayment, "name" | "amountMinor" | "dueDay">) => Promise<void>; onDeletePayment: (id: string) => Promise<void>;
}) {
  const financialSummary = calculateFinanceSummary(finance, month || "1970-01");
  const [paymentName, setPaymentName] = useState("");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentDueDay, setPaymentDueDay] = useState("1");
  const [paymentError, setPaymentError] = useState("");
  const [savingPayment, setSavingPayment] = useState(false);
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const monthTransactions = finance.transactions.filter((item) => item.date.startsWith(`${month}-`)).sort((a, b) => b.date.localeCompare(a.date));
  const [year, monthNumber] = month.split("-").map(Number);
  const previousMonth = new Date(year, monthNumber - 2, 1);
  const previousPrefix = `${previousMonth.getFullYear()}-${String(previousMonth.getMonth() + 1).padStart(2, "0")}-`;
  const totalsFor = (prefix: string) => finance.transactions.filter((item) => item.date.startsWith(prefix)).reduce((totals, item) => {
    if (item.type === "credit") totals.income += item.amountMinor;
    else if (item.type === "debit" && item.purpose === "ordinary") totals.expenses += item.amountMinor;
    else if ((item.type === "debit" || item.type === "transfer") && item.purpose === "investment") totals.investments += item.amountMinor;
    return totals;
  }, { income: 0, expenses: 0, investments: 0 });
  const current = totalsFor(`${month}-`);
  const previous = totalsFor(previousPrefix);
  const savings = current.income - current.expenses - current.investments;
  const previousSavings = previous.income - previous.expenses - previous.investments;
  const percentChange = (value: number, prior: number) => prior === 0 ? (value === 0 ? "0%" : "New") : `${value >= prior ? "+" : "−"}${Math.abs(Math.round(((value - prior) / Math.abs(prior)) * 100))}%`;
  const monthly = Array.from({ length: 12 }, (_, index) => {
    const key = `${year}-${String(index + 1).padStart(2, "0")}-`;
    const totals = totalsFor(key);
    return {
      month: new Date(year, index, 1).toLocaleString(undefined, { month: "long" }),
      shortMonth: new Date(year, index, 1).toLocaleString(undefined, { month: "short" }),
      income: totals.income,
      expenses: totals.expenses,
      investments: totals.investments,
      savings: totals.income - totals.expenses - totals.investments,
    };
  });
  const chartMax = Math.max(1, ...monthly.flatMap((item) => [item.expenses, item.savings, 0]));
  const memberIncome = new Map<string, number>();
  for (const item of monthTransactions) if (item.type === "credit") memberIncome.set(item.ownerUid, (memberIncome.get(item.ownerUid) ?? 0) + item.amountMinor);
  const changeText = (amount: number, prior: number) => `${percentChange(amount, prior)} vs last month`;
  const daysInMonth = new Date(year, monthNumber, 0).getDate();
  const firstWeekday = new Date(year, monthNumber - 1, 1).getDay();
  const paymentDates = finance.recurringPayments.map((payment) => ({
    ...payment,
    day: Math.min(payment.dueDay, daysInMonth),
  })).sort((a, b) => a.day - b.day);
  async function submitPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPaymentError("");
    setSavingPayment(true);
    try {
      await onAddPayment({ name: paymentName, amountMinor: parseMoneyToMinorUnits(paymentAmount), dueDay: Number(paymentDueDay) });
      setPaymentName("");
      setPaymentAmount("");
      setPaymentDueDay("1");
      setShowPaymentForm(false);
    } catch (cause) {
      setPaymentError(cause instanceof Error ? cause.message : "Could not add the recurring payment.");
    } finally {
      setSavingPayment(false);
    }
  }
  return <>
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-bold">This month</h2><p className="mt-1 text-sm text-slate-500">Household income, spending and savings in {currency}.</p></div><label className="text-sm text-slate-600">Month <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} className="ml-2 rounded-lg border border-slate-200 bg-white px-3 py-2" /></label></div>
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
      <div className="xl:col-span-2 xl:col-start-1 xl:row-start-1"><MetricCard title="Household net worth" value={formatMoney(financialSummary.netWorthMinor, currency)} detail={`${formatMoney(financialSummary.assetsMinor, currency)} assets − ${formatMoney(financialSummary.liabilitiesMinor, currency)} liabilities`} accent="blue" note="Accounts and other assets, less recorded liabilities." icon="netWorth" /></div>
      <div className="xl:col-span-2 xl:col-start-3 xl:row-start-1"><MetricCard title="Income this month" value={formatMoney(current.income, currency)} detail={changeText(current.income, previous.income)} accent="emerald" icon="income" extra={<div className="space-y-1 border-t border-slate-100 pt-2">{[...memberNames].map(([uid, name]) => <p key={uid} className="flex justify-between gap-3 text-xs text-slate-500"><span>{name}</span><span className="font-medium text-slate-700">{formatMoney(memberIncome.get(uid) ?? 0, currency)}</span></p>)}</div>} />
      </div>
      <div className="xl:col-span-2 xl:col-start-1 xl:row-start-2"><MetricCard title="Expenses" value={formatMoney(current.expenses, currency)} detail={changeText(current.expenses, previous.expenses)} accent="amber" note={`Investment contributions: ${formatMoney(current.investments, currency)}`} icon="expenses" /></div>
      <div className="xl:col-span-2 xl:col-start-3 xl:row-start-2"><MetricCard title="Saved" value={formatMoney(savings, currency)} detail={changeText(savings, previousSavings)} accent="violet" note="Income after ordinary expenses and investment contributions." icon="saved" /></div>
      <section className="rounded-2xl border border-slate-200 bg-white p-5 md:col-span-2 xl:col-span-2 xl:col-start-5 xl:row-span-2 xl:row-start-1">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-bold">Upcoming payments</h2><p className="mt-1 text-sm text-slate-500">Monthly bills and recurring payments</p></div><div className="ml-auto flex items-center gap-3"><span className="text-sm font-medium text-slate-600">{new Date(year, monthNumber - 1, 1).toLocaleString(undefined, { month: "long", year: "numeric" })}</span><button type="button" onClick={() => { setShowPaymentForm((current) => !current); setPaymentError(""); }} aria-label={showPaymentForm ? "Close recurring payment form" : "Add recurring payment"} aria-expanded={showPaymentForm} className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-teal-700 text-white shadow-sm transition-all duration-200 hover:scale-110 hover:bg-teal-800 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2 active:scale-95" title={showPaymentForm ? "Close recurring payment form" : "Add recurring payment"}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className={`h-5 w-5 transition-transform duration-200 ${showPaymentForm ? "rotate-45" : ""}`}><path d="M12 5v14M5 12h14" /></svg></button></div></div>
        <div className="mt-4 grid grid-cols-7 gap-1 text-center text-xs">{["S", "M", "T", "W", "T", "F", "S"].map((day, index) => <span key={`${day}-${index}`} className="py-1 font-semibold text-slate-400">{day}</span>)}{Array.from({ length: firstWeekday }, (_, index) => <span key={`empty-${index}`} />)}{Array.from({ length: daysInMonth }, (_, index) => { const day = index + 1; const dueToday = paymentDates.some((payment) => payment.day === day); return <span key={day} className={`relative rounded-lg py-1.5 ${dueToday ? "bg-emerald-50 font-semibold text-emerald-800" : "text-slate-600"}`}>{day}{dueToday && <i className="absolute bottom-0.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-emerald-600" />}</span>; })}</div>
        <div className="mt-4 space-y-2">{paymentDates.map((payment) => <div key={payment.id} className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2 text-sm"><div className="min-w-0"><p className="truncate font-medium">{payment.name}</p><p className="text-xs text-slate-500">Due {new Date(year, monthNumber - 1, payment.day).toLocaleDateString(undefined, { month: "short", day: "numeric" })} · repeats monthly</p></div><div className="flex shrink-0 items-center gap-2"><span className="font-semibold">{formatMoney(payment.amountMinor, currency)}</span><button type="button" onClick={() => void onDeletePayment(payment.id)} aria-label={`Remove ${payment.name}`} className="text-slate-400 hover:text-red-700">×</button></div></div>)}{!paymentDates.length && <p className="text-sm text-slate-500">No recurring payments added yet.</p>}</div>
        {showPaymentForm && <form onSubmit={submitPayment} className="mt-4 grid gap-2 border-t border-slate-100 pt-4 sm:grid-cols-[1.4fr_1fr_0.7fr_auto]"><input autoFocus required maxLength={80} value={paymentName} onChange={(event) => setPaymentName(event.target.value)} placeholder="Bill or payment" aria-label="Bill or payment name" className={inputClass} /><input required inputMode="decimal" value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} placeholder={`Amount (${currency})`} aria-label="Payment amount" className={inputClass} /><input required type="number" min="1" max="31" value={paymentDueDay} onChange={(event) => setPaymentDueDay(event.target.value)} aria-label="Due day of month" title="Due day each month" className={inputClass} /><button disabled={savingPayment} className={buttonClass}>{savingPayment ? "Adding…" : "Add bill"}</button>{paymentError && <p role="alert" className="text-sm text-red-700 sm:col-span-4">{paymentError}</p>}</form>}
      </section>
    </div>
    <section className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-bold">Expenses vs savings</h2><p className="mt-1 text-sm text-slate-500">Monthly totals for {year} · hover or focus a month for details</p></div><div className="flex gap-4 text-xs text-slate-500"><span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-amber-500" />Expenses</span><span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-emerald-600" />Savings</span></div></div><div className="mt-5 grid grid-cols-6 gap-3 sm:grid-cols-12">{monthly.map((item, index) => <div key={item.shortMonth} tabIndex={0} role="group" aria-label={`${item.month}: income ${formatMoney(item.income, currency)}, expenses ${formatMoney(item.expenses, currency)}, investment contributions ${formatMoney(item.investments, currency)}, saved ${formatMoney(item.savings, currency)}`} aria-describedby={`monthly-insight-${index}`} className="group relative min-w-0 rounded-lg text-center outline-none focus-visible:ring-2 focus-visible:ring-teal-500"><div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden w-52 -translate-x-1/2 rounded-xl border border-slate-700 bg-slate-900 p-3 text-left text-xs text-white shadow-xl group-hover:block group-focus:block"><p className="mb-2 font-semibold">{item.month} {year}</p><dl className="space-y-1.5"><div className="flex justify-between gap-3"><dt className="text-slate-300">Income</dt><dd className="font-medium">{formatMoney(item.income, currency)}</dd></div><div className="flex justify-between gap-3"><dt className="text-slate-300">Ordinary expenses</dt><dd className="font-medium">{formatMoney(item.expenses, currency)}</dd></div><div className="flex justify-between gap-3"><dt className="text-slate-300">Investment contributions</dt><dd className="font-medium">{formatMoney(item.investments, currency)}</dd></div><div className="flex justify-between gap-3 border-t border-slate-700 pt-1.5"><dt className="text-slate-300">After expenses + investing</dt><dd className="font-semibold">{formatMoney(item.savings, currency)}</dd></div></dl><span id={`monthly-insight-${index}`} className="sr-only">Income, ordinary expenses, investment contributions, and amount after expenses and investing for {item.month} {year}.</span></div><div className="flex h-36 items-end justify-center gap-1 border-b border-slate-100"><div className="w-3 rounded-t bg-amber-500 transition-[height] duration-300 group-hover:bg-amber-600" style={{ height: `${Math.max(2, Math.max(0, item.expenses) / chartMax * 100)}%` }} /><div className="w-3 rounded-t bg-emerald-600 transition-[height] duration-300 group-hover:bg-emerald-700" style={{ height: `${Math.max(2, Math.max(0, item.savings) / chartMax * 100)}%` }} /></div><p className="mt-2 text-xs text-slate-500">{item.shortMonth}</p></div>)}</div></section>
    <div className="grid gap-6 xl:grid-cols-2">
      <section className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-center justify-between"><h2 className="font-bold">Goals</h2><button onClick={() => onOpen("Goals")} className="text-sm font-semibold text-emerald-700">Manage →</button></div><div className="mt-4 space-y-4">{finance.goals.slice(0, 4).map((goal) => { const progress = goalProgressPercent(goal.currentMinor, goal.targetMinor); const visibleWidth = progress > 0 ? Math.max(1, progress) : 0; const progressLabel = progress > 0 && progress < 1 ? "<1%" : `${Math.round(progress)}%`; return <div key={goal.id}><div className="flex justify-between gap-3 text-sm"><span className="font-medium">{goal.name}</span><span className="text-slate-500">{progressLabel}</span></div><div role="progressbar" aria-label={`${goal.name} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-600 transition-[width] duration-500" style={{ width: `${visibleWidth}%` }} /></div><p className="mt-1 text-xs text-slate-500">{formatMoney(goal.currentMinor, currency)} of {formatMoney(goal.targetMinor, currency)}{goal.deadline ? ` · due ${goal.deadline}` : ""}</p></div>; })}{!finance.goals.length && <p className="text-sm text-slate-500">No goals yet.</p>}</div></section>
      <section className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-center justify-between"><h2 className="font-bold">Category budgets</h2><button onClick={() => onOpen("Budgets")} className="text-sm font-semibold text-emerald-700">Manage →</button></div><p className="mt-1 text-xs text-slate-500">This month’s ordinary debit transactions compared with each category limit.</p><div className="mt-4 space-y-4">{finance.budgets.filter((budget) => budget.month === month).map((budget) => { const progress = budgetProgress(budget, finance.transactions); return <div key={budget.id}><div className="flex justify-between gap-3 text-sm"><span className="font-medium">{budget.category}</span><span className={progress.overspent ? "font-semibold text-red-700" : "text-slate-500"}>{formatMoney(progress.spentMinor, currency)} / {formatMoney(budget.limitMinor, currency)}</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${progress.overspent ? "bg-red-500" : "bg-amber-500"}`} style={{ width: `${Math.min(progress.percent, 100)}%` }} /></div><p className={`mt-1 text-xs ${progress.overspent ? "font-semibold text-red-700" : "text-slate-500"}`}>{progress.overspent ? `${formatMoney(Math.abs(progress.remainingMinor), currency)} over budget` : `${formatMoney(progress.remainingMinor, currency)} remaining`}</p></div>; })}{!finance.budgets.some((budget) => budget.month === month) && <p className="text-sm text-slate-500">No category budgets for this month.</p>}</div></section>
    </div>
    <section className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-center justify-between"><h2 className="font-bold">Recent activity</h2><button onClick={() => onOpen("Transactions")} className="text-sm font-semibold text-emerald-700">View all →</button></div><div className="mt-3 divide-y divide-slate-100">{monthTransactions.slice(0, 6).map((item) => <div key={item.id} className="flex justify-between gap-3 py-3 text-sm"><div><p className="font-medium">{item.description || item.category}</p><p className="mt-1 text-xs text-slate-500">{item.date} · {item.category} · {memberNames.get(item.ownerUid) ?? "Member"}</p></div><p className={item.type === "credit" ? "font-semibold text-emerald-700" : item.type === "debit" ? "font-semibold text-red-700" : "font-semibold text-teal-700"}>{item.type === "credit" ? "+" : item.type === "debit" ? "−" : "↔"}{formatMoney(item.amountMinor, currency)}</p></div>)}{!monthTransactions.length && <p className="py-3 text-sm text-slate-500">No transactions for this month.</p>}</div></section>
    <p className="text-xs text-slate-500">Savings are calculated as income minus expenses and investment contributions. Percentages compare with the prior month.</p>
  </>;
}

function financeMemberOptions(names: Map<string, string>, currentUid: string) {
  const entries = [...names.entries()];
  if (!entries.some(([id]) => id === currentUid)) entries.push([currentUid, "You"]);
  return entries.map(([id, name]) => <option key={id} value={id}>{name}</option>);
}

function TransactionsSection({ finance, currency, uid, memberNames, filter, setFilter, typeFilter, setTypeFilter, onSave, onDelete, editing, setEditing }: {
  finance: HouseholdFinanceData;
  currency: string;
  uid: string;
  memberNames: Map<string, string>;
  filter: string;
  setFilter: (value: string) => void;
  typeFilter: string;
  setTypeFilter: (value: string) => void;
  onSave: (input: Pick<FinancialTransaction, "type" | "purpose" | "transferDestination" | "category" | "description" | "amountMinor" | "date" | "accountId" | "ownerUid">, existing?: FinancialTransaction) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  editing?: FinancialTransaction;
  setEditing: (transaction?: FinancialTransaction) => void;
}) {
  const [type, setType] = useState<FinancialTransaction["type"]>("debit");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [showDescription, setShowDescription] = useState(false);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [accountId, setAccountId] = useState("");
  const [transferDestination, setTransferDestination] = useState<FinancialTransaction["transferDestination"]>(null);
  const [showTransferDialog, setShowTransferDialog] = useState(false);
  const [error, setError] = useState("");
  const editorRef = useEditFocus<HTMLElement>(editing?.id);
  const ownerUid = editing?.ownerUid ?? uid;

  // Reset controlled form fields when a different record is selected.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setType(editing?.type ?? "debit");
    setCategory(editing?.category ?? "");
    setDescription(editing?.description ?? "");
    setShowDescription(Boolean(editing?.description));
    setAmount(moneyInputValue(editing?.amountMinor));
    setDate(editing?.date ?? new Date().toISOString().slice(0, 10));
    setAccountId(editing?.accountId ?? "");
    setTransferDestination(editing?.transferDestination ?? null);
    setShowTransferDialog(false);
  }, [editing]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    try {
      await onSave({
        type,
        purpose: type === "credit"
          ? "income"
          : type === "transfer"
            ? "investment"
            : category === SAVINGS_CATEGORY || (editing?.purpose === "investment" && category === editing.category)
              ? "investment"
              : "ordinary",
        transferDestination: type === "transfer" ? transferDestination : null,
        category,
        description,
        amountMinor: parseMoneyToMinorUnits(amount),
        date,
        accountId: accountId || null,
        ownerUid,
      }, editing);
      setEditing(undefined);
      setCategory("");
      setDescription("");
      setShowDescription(false);
      setAmount("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save transaction.");
    }
  }

  const normalizedFilter = filter.trim().toLowerCase();
  const rows = finance.transactions
    .filter((item) => typeFilter === "all" || item.type === typeFilter)
    .filter((item) => {
      if (!normalizedFilter) return true;
      const owner = memberNames.get(item.ownerUid) ?? (item.ownerUid === uid ? "You" : "Household member");
      const kind = item.type === "credit" ? "income" : item.type === "debit" ? "expense" : "transfer";
      const searchable = `${item.category} ${item.description} ${item.date} ${kind} ${owner} ${formatMoney(item.amountMinor, currency)}`;
      return searchable.toLowerCase().includes(normalizedFilter);
    })
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.toMillis() - a.createdAt.toMillis());
  function cancelTransferDialog() {
    setShowTransferDialog(false);
    setType(editing?.type ?? "debit");
    setTransferDestination(editing?.transferDestination ?? null);
  }

  return (
    <>
    <FeatureHeading section="Transactions" title="Transactions" description="Track household income, spending, and transfers." />
    <div className="grid gap-6 xl:grid-cols-[1fr_1.3fr]">
      <section ref={editorRef} className="edit-focus-target rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex items-center gap-2"><span className="rounded-lg bg-emerald-50 p-2 text-emerald-700"><WorkspaceIcon section="Transactions" /></span><h2 className="font-bold">{editing ? "Edit transaction" : "Add a transaction"}</h2></div>
        <p className="mt-1 text-xs text-slate-500">Adding a transaction never changes an account balance.</p>
        <form onSubmit={submit} className="mt-4 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-sm font-medium">Type
              <select value={type} onChange={(event) => {
                const nextType = event.target.value as FinancialTransaction["type"];
                setType(nextType);
                if (nextType === "transfer") setShowTransferDialog(true);
                else { setTransferDestination(null); setShowTransferDialog(false); }
              }} className={`${inputClass} mt-1`}>
                <option value="debit">Expense</option>
                <option value="credit">Income</option>
                <option value="transfer">Transfer</option>
              </select>
            </label>
          </div>
          {type === "transfer" && <button type="button" onClick={() => setShowTransferDialog(true)} className="w-full rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-left text-sm font-medium text-teal-800">Destination: {transferDestination === "brokerage" ? "Brokerage" : transferDestination === "cash" ? "Cash" : "Choose Brokerage or Cash"}</button>}
          <label className="block text-sm font-medium">Category
            <select required value={category} onChange={(event) => setCategory(event.target.value)} className={`${inputClass} mt-1`}>
              <option value="" disabled>Choose a category</option>
              {editing?.category && !(TRANSACTION_CATEGORIES as readonly string[]).includes(editing.category) && <option value={editing.category}>{editing.category} (existing)</option>}
              {TRANSACTION_CATEGORIES.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <div>
            <button
              type="button"
              aria-expanded={showDescription}
              onClick={() => setShowDescription((visible) => !visible)}
              className="text-sm font-medium text-teal-800 underline decoration-teal-300 underline-offset-4 hover:text-teal-600"
            >
              {showDescription ? "Hide description" : "Add description"}
            </button>
            {showDescription && (
              <label className="mt-2 block text-sm font-medium">Description (optional)
                <input autoFocus value={description} onChange={(event) => setDescription(event.target.value)} maxLength={240} placeholder="Add a note" className={`${inputClass} mt-1`} />
              </label>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-sm font-medium">Amount
              <input required inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" className={`${inputClass} mt-1`} />
            </label>
            <label className="block text-sm font-medium">Date
              <input required type="date" value={date} onChange={(event) => setDate(event.target.value)} className={`${inputClass} mt-1`} />
            </label>
          </div>
          <label className="block text-sm font-medium">Linked account (optional)
            <select value={accountId} onChange={(event) => setAccountId(event.target.value)} className={`${inputClass} mt-1`}>
              <option value="">No linked account</option>
              {finance.accounts.filter((item) => !item.archived && (type !== "transfer" || (transferDestination === "brokerage" ? item.kind === "brokerage" : transferDestination === "cash" ? item.kind === "savings" : false))).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <div className="flex gap-2">
            <button className={buttonClass}>{editing ? "Save" : "Add"}</button>
            {editing && <button type="button" onClick={() => setEditing(undefined)} className={secondaryButtonClass}>Cancel</button>}
          </div>
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        </form>
      </section>
      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-bold">Recent transactions</h2>
            <p className="mt-1 text-xs text-slate-500">{rows.length} of {finance.transactions.length} household transactions</p>
          </div>
          <div className="flex min-w-0 flex-1 gap-2 sm:max-w-md">
            <input type="search" aria-label="Search transactions" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Search category, date, amount, member…" className={`${inputClass} min-w-0`} />
            <select aria-label="Filter transaction type" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} className="rounded-lg border border-slate-300 bg-white px-2 text-sm">
              <option value="all">All types</option>
              <option value="credit">Income</option>
              <option value="debit">Expense</option>
              <option value="transfer">Transfer</option>
            </select>
          </div>
        </div>
        <div className="mt-4 divide-y divide-slate-100">
          {rows.map((item) => <div key={item.id} className="group -mx-2 flex flex-wrap items-center justify-between gap-3 rounded-xl px-2 py-3 transition-colors hover:bg-slate-50">
            <div className="flex min-w-0 items-center gap-3">
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-colors ${item.type === "credit" ? "bg-emerald-50 text-emerald-700" : item.type === "transfer" ? "bg-teal-50 text-teal-700" : "bg-amber-50 text-amber-700"}`}>
                <WorkspaceIcon section="Transactions" />
              </span>
              <div className="min-w-0">
                <p className="truncate font-semibold">{item.description || item.category}</p>
                <p className="mt-1 text-xs text-slate-500">{item.date} · {item.category} · {item.type === "credit" ? "Income" : item.type === "debit" ? "Expense" : "Transfer"} · for {memberNames.get(item.ownerUid) ?? (item.ownerUid === uid ? "You" : "Household member")}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 rounded-lg transition-transform duration-200 group-hover:scale-[1.02]">
              <p className={item.type === "credit" ? "font-semibold text-emerald-700" : item.type === "debit" ? "font-semibold text-red-700" : "font-semibold text-teal-700"}>{item.type === "credit" ? "+" : item.type === "debit" ? "−" : "↔"}{formatMoney(item.amountMinor, currency)}</p>
              <button onClick={() => setEditing(item)} className={secondaryButtonClass}>Edit</button>
              <button onClick={() => void onDelete(item.id)} className={secondaryButtonClass}>Delete</button>
            </div>
          </div>)}
          {!rows.length && <p className="py-4 text-sm text-slate-500">{normalizedFilter ? "No transactions match your search." : "No transactions yet."}</p>}
        </div>
      </section>
    </div>
    {showTransferDialog && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) cancelTransferDialog(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="transfer-dialog-title" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <h2 id="transfer-dialog-title" className="text-lg font-bold">Where should this transfer go?</h2>
        <p className="mt-2 text-sm text-slate-600">Choose the destination. The transfer will be recorded under that investment type.</p>
        <div className="mt-5 grid grid-cols-2 gap-3">
          {([ ["brokerage", "Brokerage"], ["cash", "Cash"] ] as const).map(([destination, label]) => <button key={destination} type="button" onClick={() => {
            setTransferDestination(destination);
            setAccountId("");
            setShowTransferDialog(false);
          }} className="rounded-xl border border-teal-200 bg-teal-50 px-4 py-5 text-left font-semibold text-teal-900 transition hover:border-teal-400 hover:bg-teal-100 focus:outline-none focus:ring-2 focus:ring-teal-600">
            {label}<span className="mt-1 block text-xs font-normal text-teal-800">{destination === "brokerage" ? "Brokerage account" : "Personal savings / cash"}</span>
          </button>)}
        </div>
        <p className="mt-4 text-xs text-slate-500">Account balances stay manually maintained; this entry records activity only.</p>
        <div className="mt-5 flex justify-end"><button type="button" onClick={cancelTransferDialog} className={secondaryButtonClass}>Cancel</button></div>
      </section>
    </div>}
    </>
  );
}

function BudgetsSection({ finance, currency, month, setMonth, onSave, onCopyPrevious, onDelete, editing, setEditing }: {
  finance: HouseholdFinanceData; currency: string; month: string; setMonth: (value: string) => void; onSave: (input: Pick<MonthlyBudget, "month" | "period" | "category" | "limitMinor">, existing?: MonthlyBudget) => Promise<void>; onCopyPrevious: (sourceMonth: string, targetMonth: string) => Promise<void>; onDelete: (id: string) => Promise<void>; editing?: MonthlyBudget; setEditing: (item?: MonthlyBudget) => void;
}) {
  const [category, setCategory] = useState(""); const [limit, setLimit] = useState(""); const [period, setPeriod] = useState<"monthly" | "yearly">("monthly"); const [error, setError] = useState("");
  const editorRef = useEditFocus<HTMLElement>(editing?.id);
  // Reset controlled form fields when a different record is selected.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setCategory(editing?.category ?? ""); setLimit(moneyInputValue(editing?.limitMinor)); setPeriod(editing?.period ?? "monthly"); if (editing) setMonth(editing.month); }, [editing, setMonth]);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setError(""); try { await onSave({ month: period === "yearly" ? `${month.slice(0, 4)}-01` : month, period, category, limitMinor: parseMoneyToMinorUnits(limit) }, editing); setEditing(undefined); setCategory(""); setLimit(""); setPeriod("monthly"); } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save budget."); } }
  const rows = finance.budgets.filter((item) => (item.period ?? "monthly") === "yearly" ? item.month.slice(0, 4) === month.slice(0, 4) : item.month === month);
  const previousMonth = isMonthKey(month) ? previousMonthKey(month) : "";
  const previousMonthBudgetCount = finance.budgets.filter((item) => (item.period ?? "monthly") === "monthly" && item.month === previousMonth).length;
  const [copyingPreviousMonth, setCopyingPreviousMonth] = useState(false);
  async function copyPreviousMonth() {
    if (!previousMonth || !previousMonthBudgetCount || copyingPreviousMonth) return;
    setCopyingPreviousMonth(true);
    try {
      await onCopyPrevious(previousMonth, month);
    } finally {
      setCopyingPreviousMonth(false);
    }
  }
  return (
    <div className="space-y-5">
      <FeatureHeading section="Budgets" title="Budgets" description="Set monthly limits and track household spending by category." />
      <div className="grid gap-6 xl:grid-cols-[1fr_1.2fr]">
        <section ref={editorRef} className="edit-focus-target rounded-2xl border border-slate-200 bg-white p-5 transition-shadow hover:shadow-md">
          <div className="mb-4 flex items-center gap-2"><span className="rounded-lg bg-amber-50 p-2 text-amber-700"><WorkspaceIcon section="Budgets" /></span><h2 className="font-bold">{editing ? "Edit budget" : `Create a ${period} budget`}</h2></div>
          <form onSubmit={submit} className="space-y-3">
            <label className="block text-sm font-medium">Budget period<select value={period} onChange={(event) => setPeriod(event.target.value as "monthly" | "yearly")} className={`${inputClass} mt-1`}><option value="monthly">Monthly</option><option value="yearly">Yearly</option></select></label>
            <label className="block text-sm font-medium">{period === "monthly" ? "Budget month" : "Budget year"}{period === "monthly" ? <input type="month" required value={month} onChange={(event) => setMonth(event.target.value)} className={`${inputClass} mt-1`} /> : <input type="number" required min="1900" max="9999" value={month.slice(0, 4)} onChange={(event) => setMonth(`${event.target.value}-01`)} className={`${inputClass} mt-1`} />}</label>
            <label className="block text-sm font-medium">Transaction category<select required value={category} onChange={(event) => setCategory(event.target.value)} className={`${inputClass} mt-1`}><option value="" disabled>Choose an expense category</option>{editing?.category && !(BUDGET_CATEGORIES as readonly string[]).includes(editing.category) && <option value={editing.category}>{editing.category} (existing)</option>}{BUDGET_CATEGORIES.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
            <label className="block text-sm font-medium">{period === "monthly" ? "Monthly limit" : "Yearly limit"}<input required inputMode="decimal" value={limit} onChange={(event) => setLimit(event.target.value)} placeholder={`Amount (${currency})`} className={`${inputClass} mt-1`} /></label>
            <div className="flex flex-wrap gap-2"><button className={buttonClass}>{editing ? "Save" : "Add"}</button>{editing && <button type="button" onClick={() => setEditing(undefined)} className={secondaryButtonClass}>Cancel</button>}{!editing && <button type="button" disabled={!previousMonth || !previousMonthBudgetCount || copyingPreviousMonth} onClick={() => void copyPreviousMonth()} className={`${secondaryButtonClass} disabled:cursor-not-allowed disabled:opacity-50`}>{copyingPreviousMonth ? "Copying…" : "Copy prev month"}</button>}</div>
            {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
            {!editing && <p className="text-xs text-slate-500">Copies all monthly category limits from {previousMonth || "the previous month"} into {month || "the selected month"}, updating matching categories and adding any missing ones.</p>}
          </form>
        </section>
        <section className="rounded-2xl border border-slate-200 bg-white p-5 transition-shadow hover:shadow-md">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2"><span className="rounded-lg bg-amber-50 p-2 text-amber-700"><WorkspaceIcon section="Budgets" /></span><div><h2 className="font-bold">Budget progress</h2><p className="text-xs text-slate-500">Monthly progress for {month}; yearly progress accumulates across {month.slice(0, 4)}.</p></div></div>
            <label className="text-xs font-medium text-slate-500">Month<input aria-label="Budget month" type="month" value={month} onChange={(event) => setMonth(event.target.value)} className="mt-1 block rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-slate-700 transition focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-100" /></label>
          </div>
          <div className="mt-5 space-y-5">
            {rows.map((budget) => {
              const progress = budgetProgress(budget, finance.transactions);
              const width = Math.min(progress.percent, 100);
              return <div key={budget.id} className="rounded-xl p-3 transition-colors hover:bg-slate-50">
                <div className="flex justify-between gap-3 text-sm">
                  <div className="flex items-center gap-2"><span className={`rounded-lg p-1.5 ${progress.overspent ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"}`}><WorkspaceIcon section="Budgets" /></span><div><span className="font-medium">{budget.category} <span className="text-xs font-normal text-slate-500">({(budget.period ?? "monthly")})</span></span><p className={`text-xs ${progress.overspent ? "text-red-700" : "text-slate-500"}`}>{progress.overspent ? `${formatMoney(Math.abs(progress.remainingMinor), currency)} over budget` : `${formatMoney(progress.remainingMinor, currency)} remaining`}</p></div></div>
                  <span className={progress.overspent ? "font-semibold text-red-700" : "text-slate-600"}>{formatMoney(progress.spentMinor, currency)} / {formatMoney(budget.limitMinor, currency)}</span>
                </div>
                <div role="progressbar" aria-label={`${budget.category} budget used`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={width} className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full transition-[width] duration-500 ${progress.overspent ? "bg-red-500" : "bg-amber-500"}`} style={{ width: `${width}%` }} /></div>
                <div className="mt-2 flex items-center justify-between text-xs"><span className={progress.overspent ? "font-semibold text-red-700" : "text-slate-500"}>{progress.overspent ? "Overspending alert" : `${progress.percent}% used`}</span><span className="flex gap-3"><button type="button" onClick={() => setEditing(budget)} className="rounded-md px-2 py-1 font-semibold text-teal-800 transition hover:bg-teal-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600">Edit</button><button type="button" onClick={() => void onDelete(budget.id)} className="rounded-md px-2 py-1 text-slate-500 transition hover:bg-red-50 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500">Delete</button></span></div>
              </div>;
            })}
            {!rows.length && <p className="rounded-xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">No budgets for {month}. Add one to start tracking spending.</p>}
          </div>
        </section>
      </div>
    </div>
  );
}

function GoalsSection({ finance, currency, uid, memberNames, onSave, onAddProgress, onDelete, editing, setEditing }: {
  finance: HouseholdFinanceData;
  currency: string;
  uid: string;
  memberNames: Map<string, string>;
  onSave: (input: Pick<SavingsGoal, "name" | "targetMinor" | "currentMinor" | "deadline" | "ownerUid">, existing?: SavingsGoal) => Promise<void>;
  onAddProgress: (goalId: string, amountMinor: number, onSuccess: () => void) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  editing?: SavingsGoal;
  setEditing: (item?: SavingsGoal) => void;
}) {
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [current, setCurrent] = useState("0");
  const [deadline, setDeadline] = useState("");
  const [error, setError] = useState("");
  const [progressGoalId, setProgressGoalId] = useState<string>();
  const [progressAmount, setProgressAmount] = useState("");
  const [progressError, setProgressError] = useState("");
  const [savingProgress, setSavingProgress] = useState(false);
  const editorRef = useEditFocus<HTMLElement>(editing?.id);

  // Reset controlled form fields when a different record is selected.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setName(editing?.name ?? ""); setTarget(moneyInputValue(editing?.targetMinor)); setCurrent(moneyInputValue(editing?.currentMinor) || "0"); setDeadline(editing?.deadline ?? ""); }, [editing]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    try {
      await onSave({
        name,
        targetMinor: parseMoneyToMinorUnits(target),
        currentMinor: parseMoneyToMinorUnits(current),
        deadline: deadline || null,
        ownerUid: editing?.ownerUid ?? uid,
      }, editing);
      setEditing(undefined);
      setName("");
      setTarget("");
      setCurrent("0");
      setDeadline("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save goal.");
    }
  }

  async function submitProgress(event: FormEvent<HTMLFormElement>, goalId: string) {
    event.preventDefault();
    setProgressError("");
    setSavingProgress(true);
    try {
      const amountMinor = parseMoneyToMinorUnits(progressAmount);
      if (amountMinor <= 0) throw new Error("Enter an amount greater than zero.");
      await onAddProgress(goalId, amountMinor, () => {
        setProgressGoalId(undefined);
        setProgressAmount("");
      });
    } catch (cause) {
      setProgressError(cause instanceof Error ? cause.message : "Could not update goal progress.");
    } finally {
      setSavingProgress(false);
    }
  }

  return (
    <div className="space-y-5">
      <FeatureHeading section="Goals" title="Savings goals" description="Plan for your targets and see progress grow as you contribute." />
      <div className="grid gap-6 xl:grid-cols-[1fr_1.2fr]">
      <section ref={editorRef} className="edit-focus-target rounded-2xl border border-slate-200 bg-white p-5">
        <div className="mb-4 flex items-center gap-2"><span className="rounded-lg bg-violet-50 p-2 text-violet-700"><WorkspaceIcon section="Goals" /></span><h2 className="font-bold">{editing ? "Edit goal" : "Create a savings goal"}</h2></div>
        <form onSubmit={submit} className="mt-4 space-y-3">
          <input required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} placeholder="Goal name" className={inputClass} />
          <div className="grid grid-cols-2 gap-2">
            <input required inputMode="decimal" value={target} onChange={(event) => setTarget(event.target.value)} placeholder={`Target (${currency})`} className={inputClass} />
            <input required inputMode="decimal" value={current} onChange={(event) => setCurrent(event.target.value)} placeholder="Current progress" className={inputClass} />
          </div>
          <input type="date" value={deadline} onChange={(event) => setDeadline(event.target.value)} className={inputClass} />
          <div className="flex gap-2">
            <button className={buttonClass}>{editing ? "Save" : "Add"}</button>
            {editing && <button type="button" onClick={() => setEditing(undefined)} className={secondaryButtonClass}>Cancel</button>}
          </div>
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        </form>
      </section>
      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="mb-4 flex items-center gap-2"><span className="rounded-lg bg-violet-50 p-2 text-violet-700"><WorkspaceIcon section="Goals" /></span><h2 className="font-bold">Household goals</h2></div>
        <div className="mt-4 space-y-4">
          {finance.goals.map((goal) => {
            const pct = goalProgressPercent(goal.currentMinor, goal.targetMinor);
            const visibleWidth = pct > 0 ? Math.max(1, pct) : 0;
            const progressLabel = pct > 0 && pct < 1 ? "<1" : Math.round(pct);
            return (
              <div key={goal.id} className="rounded-xl border border-slate-100 p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-violet-200 hover:shadow-sm">
                <div className="flex justify-between">
                  <div>
                    <p className="font-semibold">{goal.name}</p>
                    <p className="text-xs text-slate-500">{memberNames.get(goal.ownerUid) ?? "Member"}{goal.deadline ? ` · target ${goal.deadline}` : ""}</p>
                  </div>
                  <span className="rounded-full bg-violet-50 px-2.5 py-1 text-sm font-semibold text-violet-800">{progressLabel}%</span>
                </div>
                <div role="progressbar" aria-label={`${goal.name} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="mt-3 h-2 overflow-hidden rounded bg-slate-100"><div className="h-full rounded bg-violet-500 transition-[width] duration-500" style={{ width: `${visibleWidth}%` }} /></div>
                <p className="mt-2 text-xs text-slate-600">{formatMoney(goal.currentMinor, currency)} / {formatMoney(goal.targetMinor, currency)}{goal.currentMinor >= goal.targetMinor ? " · Complete" : ""}</p>
                {progressGoalId === goal.id ? (
                  <form onSubmit={(event) => void submitProgress(event, goal.id)} className="mt-3 space-y-2">
                    <input required disabled={savingProgress} inputMode="decimal" aria-label={`Amount to add to ${goal.name}`} value={progressAmount} onChange={(event) => setProgressAmount(event.target.value)} placeholder={`Amount to add (${currency})`} className={inputClass} />
                    <div className="flex gap-2">
                      <button disabled={savingProgress} className={buttonClass}>{savingProgress ? "Adding…" : "Add to progress"}</button>
                      <button type="button" disabled={savingProgress} onClick={() => { setProgressGoalId(undefined); setProgressError(""); }} className={secondaryButtonClass}>Cancel</button>
                    </div>
                    {progressError && <p role="alert" className="text-sm text-red-700">{progressError}</p>}
                  </form>
                ) : (
                  <div className="mt-2 flex justify-end gap-3 text-xs">
                    <button type="button" onClick={() => { setProgressGoalId(goal.id); setProgressAmount(""); setProgressError(""); }} className="rounded-lg bg-emerald-50 px-3 py-2 font-semibold text-emerald-800 transition hover:bg-emerald-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600">＋ Add progress</button>
                    <button type="button" onClick={() => setEditing(goal)} className="rounded-lg px-3 py-2 text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600">Edit</button>
                    <button type="button" onClick={() => void onDelete(goal.id)} className="rounded-lg px-3 py-2 text-slate-500 transition hover:bg-red-50 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500">Delete</button>
                  </div>
                )}
              </div>
            );
          })}
          {!finance.goals.length && <p className="text-sm text-slate-500">No goals yet.</p>}
        </div>
      </section>
      </div>
    </div>
  );
}

function InvestmentsSection({ finance, currency, uid, memberNames, editing, setEditing, snapshots, onSaveAccount, onDeleteAccount, onSnapshot, onSaveManualValue, onDeleteManualValue }: {
  finance: HouseholdFinanceData;
  currency: string;
  uid: string;
  memberNames: Map<string, string>;
  editing?: FinancialAccount;
  setEditing: (account?: FinancialAccount) => void;
  snapshots: Record<string, AccountSnapshot[]>;
  onSaveAccount: (input: Pick<FinancialAccount, "name" | "kind" | "ownerUid" | "balanceMinor">, existing?: FinancialAccount) => Promise<void>;
  onDeleteAccount: (id: string) => Promise<void>;
  onSnapshot: (accountId: string, month: string, amount: number) => Promise<void>;
  onSaveManualValue: (group: "assets" | "liabilities", input: Pick<ManualValueRecord, "name" | "amountMinor" | "ownerUid">, existing?: ManualValueRecord) => Promise<void>;
  onDeleteManualValue: (group: "assets" | "liabilities", id: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<FinancialAccount["kind"]>("savings");
  const [ownerUid, setOwnerUid] = useState(uid);
  const [balance, setBalance] = useState("");
  const [accountError, setAccountError] = useState("");
  const [snapshotAccount, setSnapshotAccount] = useState("");
  const [snapshotMonth, setSnapshotMonth] = useState("");
  const [snapshotAmount, setSnapshotAmount] = useState("");
  const [snapshotError, setSnapshotError] = useState("");
  const [manualValueName, setManualValueName] = useState("");
  const [manualValueAmount, setManualValueAmount] = useState("");
  const [manualValueType, setManualValueType] = useState<"assets" | "liabilities">("liabilities");
  const [editingManualValue, setEditingManualValue] = useState<ManualValueRecord>();
  const [manualValueError, setManualValueError] = useState("");
  const [chartMonth, setChartMonth] = useState("");
  const [activeChartMonth, setActiveChartMonth] = useState("");
  const accountEditorRef = useEditFocus<HTMLElement>(editing?.id);
  const manualValueEditorRef = useEditFocus<HTMLElement>(editingManualValue?.id);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setChartMonth(currentMonthKey());
    setSnapshotMonth(currentMonthKey());
    setActiveChartMonth(currentMonthKey());
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setName(editing?.name ?? "");
    setKind(editing?.kind ?? "savings");
    setOwnerUid(editing?.ownerUid ?? uid);
    setBalance(moneyInputValue(editing?.balanceMinor));
  }, [editing, uid]);

  const columns = [
    { kind: "brokerage", title: "Brokerage", destination: "brokerage" },
    { kind: "retirement", title: "401(k)", destination: null },
    { kind: "savings", title: "Cash", destination: "cash" },
  ] as const;
  const accounts = finance.accounts.filter((account) => !account.archived && columns.some((column) => column.kind === account.kind));
  const total = accounts.reduce((sum, account) => sum + account.balanceMinor, 0);
  const monthlyInvestmentContribution = finance.transactions
    .filter((transaction) => transaction.date.startsWith(`${chartMonth}-`)
      && (transaction.type === "debit" || transaction.type === "transfer")
      && transaction.purpose === "investment")
    .reduce((sum, transaction) => sum + transaction.amountMinor, 0);
  const recentInvestmentActivity = [
    ...accounts.map((account) => ({
      id: `account-${account.id}`,
      kind: "account" as const,
      timestamp: account.updatedAt.toMillis(),
      date: new Date(account.updatedAt.toMillis()).toLocaleDateString(),
      title: account.name,
      detail: account.createdAt.toMillis() === account.updatedAt.toMillis() ? "Account added" : "Balance updated",
      ownerUid: account.ownerUid,
      amountMinor: account.balanceMinor,
    })),
    ...finance.transactions
      .filter((transaction) => transaction.type === "transfer" || transaction.purpose === "investment")
      .map((transaction) => ({
        id: `transaction-${transaction.id}`,
        kind: "transaction" as const,
        timestamp: transaction.createdAt.toMillis(),
        date: transaction.date,
        title: transaction.description || transaction.category,
        detail: transaction.type === "transfer"
          ? transaction.transferDestination === "brokerage" ? "Transfer to brokerage" : transaction.transferDestination === "cash" ? "Transfer to cash" : "Transfer"
          : "Investment contribution",
        ownerUid: transaction.ownerUid,
        amountMinor: transaction.amountMinor,
      })),
  ].sort((first, second) => second.timestamp - first.timestamp).slice(0, 8);
  const memberUids = [...new Set([...accounts.map((account) => account.ownerUid), ...finance.transactions.filter((item) => item.type === "transfer").map((item) => item.ownerUid)])];
  const monthKeys = chartMonth ? Array.from({ length: 12 }, (_, index) => {
    const [year, month] = chartMonth.split("-").map(Number);
    const date = new Date(year, month - 1 - (11 - index), 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  }) : [];
  const chartSeries = [
    { kind: "brokerage", label: "Brokerage", color: "#0f766e", dash: "", marker: "circle" },
    { kind: "retirement", label: "401(k)", color: "#4f46e5", dash: "8 5", marker: "square" },
    { kind: "savings", label: "Cash", color: "#c2410c", dash: "2 5", marker: "diamond" },
  ] as const;
  type ChartMonth = { month: string; brokerage: number | null; retirement: number | null; savings: number | null };
  const monthlyPoints: ChartMonth[] = monthKeys.map((monthKey) => {
    const valueForKind = (kind: FinancialAccount["kind"]) => {
      const kindAccounts = accounts.filter((account) => account.kind === kind);
      if (monthKey === chartMonth) return kindAccounts.reduce((sum, account) => sum + account.balanceMinor, 0);
      const amounts = kindAccounts.flatMap((account) => (snapshots[account.id] ?? []).filter((snapshot) => snapshot.month === monthKey).map((snapshot) => snapshot.amountMinor));
      return amounts.length ? amounts.reduce((sum, value) => sum + value, 0) : null;
    };
    return { month: monthKey, brokerage: valueForKind("brokerage"), retirement: valueForKind("retirement"), savings: valueForKind("savings") };
  });
  const allChartValues = monthlyPoints.flatMap((point) => [point.brokerage, point.retirement, point.savings].filter((amount): amount is number => amount !== null));
  const maxChartValue = Math.max(1, ...allChartValues);
  const chartCoordinates = chartSeries.map((series) => ({
    ...series,
    points: monthlyPoints.flatMap((point, index) => {
      const amount = point[series.kind];
      if (amount === null) return [];
      return [{ month: point.month, amount, x: 64 + (index / Math.max(monthlyPoints.length - 1, 1)) * 636, y: 150 - (amount / maxChartValue) * 120 }];
    }),
  }));
  const selectedChartPoint = monthlyPoints.find((point) => point.month === activeChartMonth);
  const selectedChartTotal = selectedChartPoint
    ? [selectedChartPoint.brokerage, selectedChartPoint.retirement, selectedChartPoint.savings].reduce<number>((sum, amount) => sum + (amount ?? 0), 0)
    : 0;
  const chartMonthLabel = (monthKey: string, format: "short" | "long" = "short") => {
    const [year, month] = monthKey.split("-").map(Number);
    return new Date(year, month - 1, 1).toLocaleString(undefined, { month: format, ...(format === "long" ? { year: "numeric" } : {}) });
  };

  async function submitAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAccountError("");
    try {
      await onSaveAccount({ name: name.trim(), kind, ownerUid, balanceMinor: parseMoneyToMinorUnits(balance) }, editing);
      setEditing(undefined);
      setName("");
      setBalance("");
    } catch (cause) {
      setAccountError(cause instanceof Error ? cause.message : "Could not save the account.");
    }
  }
  async function removeAccount(account: FinancialAccount) {
    if (!window.confirm(`Permanently delete ${account.name} and its saved monthly snapshots? Linked transactions will remain in your history.`)) return;
    await onDeleteAccount(account.id);
    if (editing?.id === account.id) setEditing(undefined);
    if (snapshotAccount === account.id) setSnapshotAccount("");
  }
  async function submitSnapshot(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSnapshotError("");
    try {
      if ((snapshots[snapshotAccount] ?? []).some((snapshot) => snapshot.month === snapshotMonth)) {
        throw new Error("A snapshot already exists for that account and month. Monthly snapshots are preserved as history.");
      }
      await onSnapshot(snapshotAccount, snapshotMonth, parseMoneyToMinorUnits(snapshotAmount));
      setSnapshotAmount("");
    } catch (cause) {
      setSnapshotError(cause instanceof Error ? cause.message : "Could not record the snapshot.");
    }
  }
  async function submitManualValue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setManualValueError("");
    try {
      await onSaveManualValue(manualValueType, { name: manualValueName, amountMinor: parseMoneyToMinorUnits(manualValueAmount), ownerUid: editingManualValue?.ownerUid ?? uid }, editingManualValue);
      setEditingManualValue(undefined);
      setManualValueName("");
      setManualValueAmount("");
    } catch (cause) {
      setManualValueError(cause instanceof Error ? cause.message : `Could not save the ${manualValueType === "assets" ? "asset" : "liability"}.`);
    }
  }

  return <div className="space-y-6">
    <FeatureHeading section="Investments" title="Investments" description="Review account balances, compare performance, and record monthly snapshots." />
    <section className="group space-y-5 rounded-2xl border border-slate-200 bg-white p-6 transition-all duration-200 hover:border-teal-200 hover:shadow-md">
      <div className="flex flex-wrap items-center justify-between gap-4"><div className="flex items-center gap-3"><span className="rounded-2xl bg-teal-50 p-3 text-teal-800 transition-transform duration-200 group-hover:scale-105"><WorkspaceIcon section="Investments" /></span><div><p className="text-sm font-medium text-slate-500">Total investments</p><p className="mt-1 text-4xl font-bold tracking-tight">{formatMoney(total, currency)}</p></div></div><div className="rounded-xl bg-emerald-50 px-4 py-3 text-right"><p className="text-xs font-medium text-emerald-800">Contributed this month</p><p className="mt-1 text-lg font-bold text-emerald-900">{formatMoney(monthlyInvestmentContribution, currency)}</p></div></div>
      <p className="mt-3 text-sm text-slate-500">Total includes manually maintained Brokerage, 401(k), and Cash balances. Contributions are shown separately so they are not double-counted.</p>
    <section className="grid gap-4 lg:grid-cols-3">{columns.map((column) => {
      const columnAccounts = accounts.filter((account) => account.kind === column.kind);
      const columnTotal = columnAccounts.reduce((sum, account) => sum + account.balanceMinor, 0);
      return <article key={column.kind} className="rounded-2xl border border-slate-200 bg-white p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-teal-200 hover:shadow-md">
        <div className="flex items-start justify-between gap-2"><div className="flex items-center gap-2"><span className={`rounded-lg p-2 ${column.kind === "savings" ? "bg-emerald-50 text-emerald-700" : "bg-indigo-50 text-indigo-700"}`}><InvestmentKindIcon kind={column.kind} /></span><h2 className="font-bold">{column.title}</h2></div><p className="text-lg font-bold">{formatMoney(columnTotal, currency)}</p></div>
        <h3 className="mt-5 text-xs font-semibold uppercase tracking-wide text-slate-500">By member</h3>
        <div className="mt-2 divide-y divide-slate-100">{memberUids.map((memberUid) => {
          const memberBalance = columnAccounts.filter((account) => account.ownerUid === memberUid).reduce((sum, account) => sum + account.balanceMinor, 0);
          return <div key={memberUid} className="flex justify-between gap-3 py-2"><p className="text-sm font-medium">{memberNames.get(memberUid) ?? "Member"}</p><p className="text-sm font-semibold">{formatMoney(memberBalance, currency)}</p></div>;
        })}{!memberUids.length && <p className="py-2 text-sm text-slate-500">No member balances yet.</p>}</div>
        {columnAccounts.length > 0 && <div className="mt-4 border-t border-slate-100 pt-3">{columnAccounts.map((account) => <div key={account.id} className="flex items-center justify-between gap-2 py-1 text-xs text-slate-600"><span>{account.name} · {memberNames.get(account.ownerUid) ?? "Member"}</span><span className="flex items-center gap-2"><span>{formatMoney(account.balanceMinor, currency)}</span><button type="button" onClick={() => setEditing(account)} className="font-semibold text-teal-800 underline">Edit balance</button></span></div>)}</div>}
      </article>;
    })}</section>
    <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2"><span className="rounded-lg bg-indigo-50 p-2 text-indigo-700"><WorkspaceIcon section="Investments" /></span><div><h2 className="font-bold">Monthly investment balances</h2><p className="mt-1 text-sm text-slate-500">Hover or focus a month to compare Brokerage, 401(k), and Cash.</p></div></div>
        <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs font-medium text-slate-600">{chartSeries.map((series) => <span key={series.kind} className="inline-flex items-center gap-2"><svg aria-hidden="true" width="24" height="10" viewBox="0 0 24 10"><line x1="1" y1="5" x2="23" y2="5" stroke={series.color} strokeWidth="3" strokeDasharray={series.dash || undefined} /></svg>{series.label}</span>)}</div>
      </div>
      <p className="mt-2 text-xs text-slate-500">Past months use available saved snapshots; the current month uses latest balances. Missing snapshots show as —.</p>
      {chartMonth ? <div className="mt-4 overflow-x-auto rounded-xl bg-slate-50/80 p-2 sm:p-4">
        <svg viewBox="0 0 730 205" role="group" aria-label="Interactive 12-month investment balance chart" className="h-64 min-w-[680px] w-full overflow-visible">
          {[0, 1, 2, 3].map((step) => {
            const y = 150 - step * 40;
            const value = Math.round(maxChartValue * step / 3);
            return <g key={step}><line x1="58" y1={y} x2="708" y2={y} stroke="#e2e8f0" strokeWidth="1" /><text x="52" y={y - 4} textAnchor="end" fontSize="10" fill="#64748b">{formatMoney(value, currency)}</text></g>;
          })}
          {monthKeys.map((monthKey, index) => {
            const x = 64 + (index / Math.max(monthKeys.length - 1, 1)) * 636;
            const point = monthlyPoints[index];
            const val = (amount: number | null) => amount === null ? "no snapshot" : formatMoney(amount, currency);
            const description = `${monthKey}. Brokerage ${val(point.brokerage)}; 401(k) ${val(point.retirement)}; Cash ${val(point.savings)}.`;
            return <rect key={monthKey} x={x - 22} y="12" width="44" height="164" rx="8" fill={activeChartMonth === monthKey ? "#ccfbf1" : "transparent"} opacity={activeChartMonth === monthKey ? "0.65" : "1"} className="cursor-pointer transition-colors duration-200 focus:outline-none motion-reduce:transition-none" tabIndex={0} role="button" aria-label={description} aria-describedby="investment-chart-detail" aria-pressed={activeChartMonth === monthKey} onMouseEnter={() => setActiveChartMonth(monthKey)} onMouseLeave={() => setActiveChartMonth("")} onFocus={() => setActiveChartMonth(monthKey)} onBlur={() => setActiveChartMonth("")} onKeyDown={(event) => { if (event.key === "Escape") { setActiveChartMonth(""); (event.currentTarget as SVGRectElement).blur(); } }} />;
          })}
          {chartCoordinates.map((series) => <g key={series.kind} aria-hidden="true" pointerEvents="none">
            {series.points.length > 1 && <polyline points={series.points.map((point) => `${point.x},${point.y}`).join(" ")} fill="none" stroke={series.color} strokeWidth={activeChartMonth && series.points.some((point) => point.month === activeChartMonth) ? "4" : "3"} strokeDasharray={series.dash || undefined} strokeLinejoin="round" strokeLinecap="round" className="investment-chart-line" />}
            {series.points.map((point) => {
              const active = point.month === activeChartMonth;
              if (series.marker === "square") return <rect key={point.month} x={point.x - (active ? 5 : 3.5)} y={point.y - (active ? 5 : 3.5)} width={active ? 10 : 7} height={active ? 10 : 7} rx="1" fill={series.color} className="transition-all duration-200 motion-reduce:transition-none"><title>{series.label}, {point.month}: {formatMoney(point.amount, currency)}</title></rect>;
              if (series.marker === "diamond") return <polygon key={point.month} points={`${point.x},${point.y - (active ? 6 : 4)} ${point.x + (active ? 6 : 4)},${point.y} ${point.x},${point.y + (active ? 6 : 4)} ${point.x - (active ? 6 : 4)},${point.y}`} fill={series.color} className="transition-all duration-200 motion-reduce:transition-none"><title>{series.label}, {point.month}: {formatMoney(point.amount, currency)}</title></polygon>;
              return <circle key={point.month} cx={point.x} cy={point.y} r={active ? 6 : 4} fill={series.color} className="transition-all duration-200 motion-reduce:transition-none"><title>{series.label}, {point.month}: {formatMoney(point.amount, currency)}</title></circle>;
            })}
          </g>)}
          {monthKeys.map((monthKey, index) => <text key={monthKey} x={64 + (index / Math.max(monthKeys.length - 1, 1)) * 636} y="174" textAnchor="middle" fontSize="10" fill="#64748b">{chartMonthLabel(monthKey)}</text>)}
        </svg>
      </div> : <p className="mt-4 rounded-lg bg-slate-50 p-4 text-sm text-slate-500">Loading monthly history…</p>}
      {selectedChartPoint && <div id="investment-chart-detail" aria-live="polite" className="mt-4 grid gap-3 rounded-xl border border-teal-100 bg-teal-50/70 p-4 sm:grid-cols-[1fr_auto] sm:items-center"><div><p className="text-sm font-semibold text-slate-800">{chartMonthLabel(selectedChartPoint.month, "long")} breakdown</p><p className="mt-1 text-xs text-slate-600">Manual balances; no market pricing. “—” means that group has no saved snapshot.</p></div><div className="grid grid-cols-2 gap-x-5 gap-y-2 text-sm sm:grid-cols-4">{chartSeries.map((series) => <p key={series.kind} className="flex items-center gap-2"><i aria-hidden="true" className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: series.color }} /><span className="text-slate-700">{series.label}</span><strong className="ml-auto text-slate-900">{selectedChartPoint[series.kind] === null ? "—" : formatMoney(selectedChartPoint[series.kind]!, currency)}</strong></p>)}<p className="col-span-2 flex justify-between border-t border-teal-100 pt-2 text-sm font-semibold text-slate-800 sm:col-span-4"><span>Recorded snapshot total</span><span>{formatMoney(selectedChartTotal, currency)}</span></p></div></div>}
      <details className="mt-4 rounded-xl border border-slate-200">
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-700 hover:text-teal-800">View monthly balances as a table</summary>
        <div className="overflow-x-auto px-4 pb-4"><table className="w-full min-w-[520px] text-left text-sm"><caption className="sr-only">Monthly investment balances by account type</caption><thead><tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500"><th className="py-2 pr-3">Month</th><th className="py-2 pr-3">Brokerage</th><th className="py-2 pr-3">401(k)</th><th className="py-2">Cash</th></tr></thead><tbody>{monthlyPoints.map((point) => <tr key={point.month} className="border-b border-slate-100 last:border-0"><th scope="row" className="py-2 pr-3 font-medium">{point.month}</th>{chartSeries.map((series) => <td key={series.kind} className="py-2 pr-3">{point[series.kind] === null ? "No snapshot" : formatMoney(point[series.kind]!, currency)}</td>)}</tr>)}</tbody></table></div>
      </details>
    </div>
    </section>
    <section className="grid gap-6 xl:grid-cols-2">
      <section ref={accountEditorRef} className="edit-focus-target rounded-2xl border border-slate-200 bg-white p-5"><h2 className="font-bold">{editing ? "Edit account" : "Add an account"}</h2><p className="mt-1 text-xs text-slate-500">Balances are manual and in {currency}. Saving a balance records this month’s snapshot.</p><form onSubmit={submitAccount} className="mt-4 space-y-3"><input required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} placeholder="Account name" className={inputClass} /><select value={kind} onChange={(event) => setKind(event.target.value as FinancialAccount["kind"])} className={inputClass}><option value="savings">Cash / Personal Savings</option><option value="brokerage">Brokerage</option><option value="retirement">Retirement / 401(k)</option></select><select value={ownerUid} onChange={(event) => setOwnerUid(event.target.value)} className={inputClass}>{financeMemberOptions(memberNames, uid)}</select><input required inputMode="decimal" value={balance} onChange={(event) => setBalance(event.target.value)} placeholder="Current balance" className={inputClass} /><div className="flex gap-2"><button className={buttonClass}>{editing ? "Save" : "Add"}</button>{editing && <button type="button" onClick={() => setEditing(undefined)} className={secondaryButtonClass}>Cancel</button>}</div>{accountError && <p role="alert" className="text-sm text-red-700">{accountError}</p>}</form><div className="mt-5 border-t border-slate-100 pt-4"><h3 className="font-semibold">Household accounts</h3><div className="mt-2 divide-y divide-slate-100">{finance.accounts.map((account) => <div key={account.id} className="flex items-center justify-between gap-3 py-2"><div><p className="text-sm font-medium">{account.name}{account.archived ? " · archived" : ""}</p><p className="text-xs text-slate-500">{account.kind} · {memberNames.get(account.ownerUid) ?? "Member"}</p></div><div className="flex items-center gap-2"><span className="text-sm font-semibold">{formatMoney(account.balanceMinor, currency)}</span>{!account.archived && <button type="button" onClick={() => setEditing(account)} className="text-xs font-semibold text-teal-800 underline">Edit</button>}<button type="button" onClick={() => void removeAccount(account)} className="text-xs font-semibold text-red-700 underline">Delete</button></div></div>)}{!finance.accounts.length && <p className="py-3 text-sm text-slate-500">No accounts yet.</p>}</div></div></section>
      <section ref={manualValueEditorRef} className="edit-focus-target rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="font-bold">Household assets &amp; liabilities</h2>
        <p className="mt-1 text-xs text-slate-500">Record assets and debts. Assets increase household net worth; liabilities reduce it.</p>
        <form onSubmit={submitManualValue} className="mt-4 space-y-3">
          <label className="block text-sm font-medium">Record type<select value={manualValueType} onChange={(event) => setManualValueType(event.target.value as "assets" | "liabilities")} className={`${inputClass} mt-1`}><option value="assets">Asset</option><option value="liabilities">Liability</option></select></label>
          <input required maxLength={80} value={manualValueName} onChange={(event) => setManualValueName(event.target.value)} placeholder={manualValueType === "assets" ? "Asset name (e.g. home, vehicle)" : "Debt name (e.g. car loan)"} className={inputClass} />
          <div className="flex gap-2"><input required inputMode="decimal" value={manualValueAmount} onChange={(event) => setManualValueAmount(event.target.value)} placeholder={`Current value (${currency})`} className={inputClass} /><button className={buttonClass}>{editingManualValue ? "Save" : "Add"}</button></div>
          {editingManualValue && <button type="button" onClick={() => { setEditingManualValue(undefined); setManualValueName(""); setManualValueAmount(""); }} className={secondaryButtonClass}>Cancel</button>}
          {manualValueError && <p role="alert" className="text-sm text-red-700">{manualValueError}</p>}
        </form>
        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          {([
            { group: "assets", title: "Household assets", records: finance.assets },
            { group: "liabilities", title: "Household liabilities", records: finance.liabilities },
          ] as const).map(({ group, title, records }) => (
            <div key={group} className="border-t border-slate-100 pt-4">
              <h3 className="font-semibold">{title}</h3>
              <div className="mt-2 divide-y divide-slate-100">
                {records.map((item) => <div key={item.id} className="flex items-center justify-between gap-3 py-2"><div><p className="text-sm font-medium">{item.name}</p><p className="text-xs text-slate-500">{memberNames.get(item.ownerUid) ?? "Member"}</p></div><div className="flex items-center gap-2"><span className="text-sm font-semibold">{formatMoney(item.amountMinor, currency)}</span>{item.ownerUid === uid && <><button type="button" onClick={() => { setManualValueType(group); setEditingManualValue(item); setManualValueName(item.name); setManualValueAmount(moneyInputValue(item.amountMinor)); }} className="text-xs font-semibold text-teal-800 underline">Edit</button><button type="button" onClick={() => void onDeleteManualValue(group, item.id)} className="text-xs font-semibold text-slate-500 underline">Delete</button></>}</div></div>)}
                {!records.length && <p className="py-3 text-sm text-slate-500">No {group} added.</p>}
              </div>
            </div>
          ))}
        </div>
      </section>
    </section>
    <section className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="font-bold">Recent investment activity</h2><p className="mt-1 text-xs text-slate-500">Includes account additions and balance changes, plus investment contributions and transfers. Account balances are not counted as transactions.</p><div className="mt-3 divide-y divide-slate-100">{recentInvestmentActivity.map((item) => <div key={item.id} className="flex justify-between gap-3 py-3 text-sm"><div><p className="font-medium">{item.title}</p><p className="mt-1 text-xs text-slate-500">{item.date} · {item.detail} · {memberNames.get(item.ownerUid) ?? "Member"}</p></div><p className="font-semibold text-teal-800">{formatMoney(item.amountMinor, currency)}</p></div>)}{!recentInvestmentActivity.length && <p className="py-3 text-sm text-slate-500">No investment activity recorded yet.</p>}</div></section>
    <section className="rounded-2xl border border-slate-200 bg-white p-5">
      <h2 className="font-bold">Add a monthly snapshot</h2>
      <p className="mt-1 text-xs text-slate-500">Historical snapshots are saved at the bottom of this page and preserve existing monthly records.</p>
      <form onSubmit={submitSnapshot} className="mt-4 grid gap-2 sm:grid-cols-[1.4fr_1fr_1fr_auto]"><select required value={snapshotAccount} onChange={(event) => setSnapshotAccount(event.target.value)} className={inputClass}><option value="">Choose account</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {memberNames.get(account.ownerUid) ?? "Member"}</option>)}</select><input required aria-label="Snapshot month" type="month" value={snapshotMonth} onChange={(event) => setSnapshotMonth(event.target.value)} className={inputClass} /><input required aria-label="Snapshot balance" inputMode="decimal" value={snapshotAmount} onChange={(event) => setSnapshotAmount(event.target.value)} placeholder="Historical balance" className={inputClass} /><button className={buttonClass}>Save snapshot</button></form>{snapshotError && <p role="alert" className="mt-2 text-sm text-red-700">{snapshotError}</p>}
    </section>
  </div>;
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
