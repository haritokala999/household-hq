
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  createEmailAccount,
  signInWithEmail,
  signInWithGoogle,
} from "@/lib/auth";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      if (mode === "signup") {
        await createEmailAccount(name.trim(), email.trim(), password);
      } else {
        await signInWithEmail(email.trim(), password);
      }

      router.replace("/");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Something went wrong.";
      setError(message.replace("Firebase: ", ""));
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogleSignIn() {
    setError("");
    setLoading(true);

    try {
      await signInWithGoogle();
      router.replace("/");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Google sign-in failed.";
      setError(message.replace("Firebase: ", ""));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f3f7f5] px-4 py-10 text-slate-900">
      <section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-sm transition-shadow duration-200 hover:shadow-lg">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-teal-700 text-xl font-bold text-white">
            H
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Welcome to Household HQ
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            Your household finances, together.
          </p>
        </div>

        <button
          type="button"
          onClick={handleGoogleSignIn}
          disabled={loading}
          className="flex w-full items-center justify-center rounded-xl border border-slate-300 px-4 py-3 text-sm font-medium hover:border-teal-200 hover:bg-teal-50 hover:text-teal-800 disabled:opacity-60"
        >
          Continue with Google
        </button>

        <div className="my-6 flex items-center gap-3">
          <div className="h-px flex-1 bg-slate-200" />
          <span className="text-xs text-slate-400">OR EMAIL</span>
          <div className="h-px flex-1 bg-slate-200" />
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === "signup" && (
            <div>
              <label htmlFor="name" className="mb-1.5 block text-sm font-medium">
                Name
              </label>
              <input
                id="name"
                type="text"
                autoComplete="name"
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2.5 outline-none focus:border-teal-600"
                placeholder="Your name"
              />
            </div>
          )}

          <div>
            <label htmlFor="email" className="mb-1.5 block text-sm font-medium">
              Email address
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2.5 outline-none focus:border-teal-600"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="mb-1.5 block text-sm font-medium"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete={
                mode === "signup" ? "new-password" : "current-password"
              }
              minLength={6}
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2.5 outline-none focus:border-teal-600"
              placeholder="At least 6 characters"
            />
          </div>

          {error && (
            <p
              role="alert"
              className="rounded-lg bg-red-50 p-3 text-sm text-red-700"
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-teal-700 px-4 py-3 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-60"
          >
            {loading
              ? "Please wait..."
              : mode === "signup"
                ? "Create account"
                : "Sign in"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-500">
          {mode === "signup" ? "Already have an account?" : "New to Household HQ?"}{" "}
          <button
            type="button"
            onClick={() => {
              setMode(mode === "signup" ? "login" : "signup");
              setError("");
            }}
            className="font-semibold text-teal-800 underline underline-offset-4 hover:text-teal-600"
          >
            {mode === "signup" ? "Sign in" : "Create an account"}
          </button>
        </p>
      </section>
    </main>
  );
}
