"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import AuthGuard from "@/components/auth-guard";
import { signOutUser } from "@/lib/auth";
import { useHouseholds } from "@/hooks/use-households";
import { createHousehold } from "@/lib/households";
import { acceptHouseholdInvitation, INVITATION_CODE_LENGTH } from "@/lib/invitations";
import { auth, db } from "@/lib/firebase";
import { HOUSEHOLD_CURRENCIES, HOUSEHOLD_CURRENCY_NAMES, type HouseholdCurrency } from "@/lib/types";

export default function HouseholdSetupPage() {
  const router = useRouter();
  const { uid, households, loading: checking, error: lookupError, retry, selectHousehold } = useHouseholds();
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState<HouseholdCurrency>("USD");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState("");
  const [invitationCode, setInvitationCode] = useState("");
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState("");

  useEffect(() => {
    if (!checking && !lookupError && households.length > 0) router.replace("/");
  }, [checking, households.length, lookupError, router]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (creating) return;
    setCreateError("");
    setCreating(true);
    try {
      const householdId = await createHousehold(name, currency);
      selectHousehold(householdId);
      router.replace("/");
    } catch (cause) {
      setCreateError(cause instanceof Error ? cause.message : "Could not create the household. Retry to check the same request.");
    } finally {
      setCreating(false);
    }
  }

  async function handleSignOut() {
    setSigningOut(true);
    setSignOutError("");
    try {
      await signOutUser();
      router.replace("/login");
    } catch (cause) {
      setSignOutError(cause instanceof Error ? cause.message : "Could not sign out. Please try again.");
    } finally {
      setSigningOut(false);
    }
  }

  async function handleJoin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const user = auth.currentUser;
    if (!user) return;
    setJoining(true);
    setJoinError("");
    try {
      const householdId = await acceptHouseholdInvitation(db, invitationCode, {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
      });
      selectHousehold(householdId);
      router.replace("/");
    } catch (cause) {
      setJoinError(cause instanceof Error ? cause.message : "Could not accept the invitation.");
    } finally {
      setJoining(false);
    }
  }

  const canCreate = !checking && !lookupError && households.length === 0 && Boolean(uid);

  return (
    <AuthGuard>
      <main className="flex min-h-screen flex-col bg-[#f3f7f5] text-slate-900">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-4 sm:px-8">
          <div><p className="font-bold">Household HQ</p><p className="text-xs text-slate-500">Your money, together.</p></div>
          <div className="flex items-center gap-3">
            {signOutError && <p role="alert" className="max-w-xs text-sm text-red-700">{signOutError}</p>}
            <button disabled={signingOut} onClick={handleSignOut} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-60">
              {signingOut ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </header>
        <section className="flex flex-1 items-center justify-center p-5">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
            <p className="text-sm font-semibold text-emerald-700">Getting started</p>
            <h1 className="mt-2 text-2xl font-bold">Create your household</h1>
            <p className="mt-2 text-sm leading-6 text-slate-600">Your household is a shared workspace for the people you invite. You’ll be its owner.</p>
            {checking ? (
              <p role="status" className="mt-6 text-sm text-slate-500">Checking your membership…</p>
            ) : lookupError ? (
              <div className="mt-6 rounded-lg bg-red-50 p-4 text-sm text-red-800">
                <p role="alert">Could not check your household membership: {lookupError}</p>
                <button onClick={retry} className="mt-3 font-semibold underline">Retry membership lookup</button>
              </div>
            ) : households.length > 0 ? (
              <p role="status" className="mt-6 text-sm text-slate-600">Opening your existing household…</p>
            ) : (
              <form onSubmit={handleSubmit} className="mt-6 space-y-4">
                <div>
                  <label htmlFor="household-name" className="mb-1.5 block text-sm font-medium">Household name</label>
                  <input id="household-name" required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. The Taylor household" className="w-full rounded-xl border border-slate-300 px-3 py-2.5 outline-none focus:border-emerald-600" />
                </div>
                <div>
                  <label htmlFor="currency" className="mb-1.5 block text-sm font-medium">Currency</label>
                  <select id="currency" value={currency} onChange={(event) => setCurrency(event.target.value as HouseholdCurrency)} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5">
                    {HOUSEHOLD_CURRENCIES.map((supportedCurrency) => <option key={supportedCurrency} value={supportedCurrency}>{supportedCurrency} — {HOUSEHOLD_CURRENCY_NAMES[supportedCurrency]}</option>)}
                  </select>
                </div>
                {createError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{createError}</p>}
                <button disabled={!canCreate || creating} className="w-full rounded-xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60">
                  {creating ? "Creating…" : "Create household"}
                </button>
              </form>
            )}
            <div className="mt-8 border-t border-slate-100 pt-6">
              <h2 className="font-semibold">Joining an existing household?</h2>
              <p className="mt-2 text-xs text-slate-500">Enter the private {INVITATION_CODE_LENGTH}-character code shared by the household owner. Your account email does not need to be verified.</p>
              <form onSubmit={handleJoin} className="mt-4 space-y-3">
                <label htmlFor="invitation-code" className="block text-sm font-medium">Invitation code</label>
                <input id="invitation-code" required autoCapitalize="none" autoCorrect="off" spellCheck={false} pattern="[A-Za-z0-9_-]{22}" maxLength={INVITATION_CODE_LENGTH} value={invitationCode} onChange={(event) => setInvitationCode(event.target.value.replace(/[^A-Za-z0-9_-]/g, "").slice(0, INVITATION_CODE_LENGTH))} placeholder="Paste private invitation code" className="w-full rounded-xl border border-slate-300 px-3 py-2.5 font-mono text-sm outline-none focus:border-emerald-600" />
                {joinError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{joinError}</p>}
                <button disabled={joining || !uid} className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold hover:bg-slate-50 disabled:opacity-60">{joining ? "Joining…" : "Accept invitation"}</button>
              </form>
            </div>
          </div>
        </section>
      </main>
    </AuthGuard>
  );
}
