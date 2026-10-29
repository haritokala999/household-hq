
"use client";

import Image from "next/image";
import { onAuthStateChanged } from "firebase/auth";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createEmailAccount,
  getGoogleRedirectResult,
  signInWithEmail,
  signInWithGoogle,
} from "@/lib/auth";
import { auth } from "@/lib/firebase";

function getSignInErrorMessage(error: unknown) {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? error.code
      : undefined;

  switch (code) {
    case "auth/unauthorized-domain":
      return "This website domain is not authorized for sign-in. Add it under Firebase Authentication settings > Authorized domains.";
    case "auth/operation-not-allowed":
      return "Google sign-in is not enabled. Enable it in Firebase Authentication > Sign-in method.";
    case "auth/invalid-api-key":
      return "The Firebase API key is missing or invalid for this deployment.";
    case "auth/popup-closed-by-user":
      return "The Google sign-in window was closed before sign-in finished.";
    default:
      return error instanceof Error
        ? error.message.replace("Firebase: ", "")
        : "Google sign-in failed.";
  }
}

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [showAuth, setShowAuth] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const authPanelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!showAuth || !authPanelRef.current) return;
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const frame = requestAnimationFrame(() => {
      const panelTop = authPanelRef.current?.getBoundingClientRect().top;
      if (panelTop === undefined) return;
      window.scrollTo({
        top: window.scrollY + panelTop,
        behavior: prefersReducedMotion ? "auto" : "smooth",
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [showAuth]);

  useEffect(() => {
    let isMounted = true;
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (isMounted && user) router.replace("/");
    });

    getGoogleRedirectResult()
      .then((result) => {
        if (isMounted && result) router.replace("/");
      })
      .catch((err: unknown) => {
        if (isMounted) {
          setError(getSignInErrorMessage(err));
          setShowAuth(true);
        }
      });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [router]);

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
      const result = await signInWithGoogle();
      if (result) router.replace("/");
    } catch (err) {
      setError(getSignInErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="signin-screen relative min-h-[100svh] overflow-hidden text-slate-900">
      <div
        className="signin-layout mx-auto w-full"
        data-auth-open={showAuth}
      >
        <section className="signin-brand-panel relative isolate overflow-hidden p-5 text-white sm:p-6 lg:p-8">
          <div className="relative z-10 flex items-center gap-3">
            <Image
              src="/householdhq-icon.svg"
              alt=""
              width={48}
              height={48}
              priority
              className="h-12 w-12 rounded-xl object-contain shadow-md"
            />
            <span className="text-xl font-bold tracking-tight">HouseholdHQ</span>
          </div>

          <div className="relative z-10 mt-7 max-w-lg sm:mt-8 lg:mt-8">
            <h1 className="text-3xl font-semibold leading-tight tracking-tight sm:text-4xl lg:text-5xl">
              One home.
              <br />
              One financial plan.
            </h1>
            <p className="mt-3 max-w-md text-base leading-7 text-teal-50/85 sm:mt-4 sm:text-lg">
              Bring your household finances together and make every next step
              feel clearer.
            </p>
          </div>

          <div className="relative mt-5 rounded-2xl border border-white/15 bg-white/[0.08] p-3 backdrop-blur-sm sm:mt-6 sm:p-4">
            <svg
              aria-hidden="true"
              viewBox="0 0 520 220"
              className="h-24 w-full sm:h-32"
              fill="none"
            >
              <path
                d="M42 166H478"
                stroke="rgb(255 255 255 / 18%)"
                strokeWidth="1.5"
                strokeDasharray="4 8"
              />
              <path
                d="M62 142C124 142 130 112 190 112S259 132 315 82 389 74 458 35"
                stroke="rgb(255 255 255 / 18%)"
                strokeWidth="10"
                strokeLinecap="round"
              />
              <path
                className="signin-journey-line"
                d="M62 142C124 142 130 112 190 112S259 132 315 82 389 74 458 35"
                stroke="#6EE7B7"
                strokeWidth="4"
                strokeLinecap="round"
              />
              <g className="signin-journey-node signin-journey-node-one">
                <circle cx="62" cy="142" r="12" fill="#0F766E" />
                <circle cx="62" cy="142" r="5" fill="white" />
              </g>
              <g className="signin-journey-node signin-journey-node-two">
                <circle cx="260" cy="120" r="12" fill="#0F766E" />
                <circle cx="260" cy="120" r="5" fill="white" />
              </g>
              <g className="signin-journey-node signin-journey-node-three">
                <circle cx="458" cy="35" r="14" fill="#34D399" />
                <path
                  d="m452 35 4 4 8-9"
                  stroke="#064E3B"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </g>
            </svg>
            <div className="mt-2 flex justify-center">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-slate-950/15 px-3 py-2 text-xs font-semibold tracking-wide text-teal-50 shadow-inner sm:gap-3 sm:px-4 sm:text-sm">
                <span className="flex items-center gap-1.5"><span className="signin-step-marker">01</span>Plan</span>
                <span aria-hidden="true" className="text-teal-200/60">→</span>
                <span className="flex items-center gap-1.5"><span className="signin-step-marker">02</span>Track</span>
                <span aria-hidden="true" className="text-teal-200/60">→</span>
                <span className="flex items-center gap-1.5"><span className="signin-step-marker">03</span>Grow</span>
              </div>
            </div>
          </div>

          <p className="relative z-10 mt-4 text-sm text-teal-50/70">
            A shared view of where you are and where you’re going.
          </p>
          {!showAuth && (
            <button
              type="button"
              onClick={() => setShowAuth(true)}
              className="relative z-10 mt-6 rounded-xl bg-white px-6 py-3 text-sm font-semibold text-teal-900 shadow-lg hover:bg-teal-50"
            >
              Sign in to HouseholdHQ
            </button>
          )}
          <div aria-hidden="true" className="signin-brand-orb signin-brand-orb-one" />
          <div aria-hidden="true" className="signin-brand-orb signin-brand-orb-two" />
        </section>

        {showAuth && <section ref={authPanelRef} className="signin-auth-panel relative z-10 w-full p-6 sm:p-8 lg:p-10">
          <button
            type="button"
            onClick={() => setShowAuth(false)}
            className="mb-5 text-sm font-medium text-teal-800 hover:text-teal-600"
          >
            ← Back
          </button>
          <div className="mb-7">
            <h2 className="text-2xl font-semibold tracking-tight">
              {mode === "signup" ? "Create your account" : "Welcome back"}
            </h2>
            <p className="mt-2 text-sm text-slate-500">
              {mode === "signup"
                ? "Start planning your household finances together."
                : "Sign in to your household financial plan."}
            </p>
          </div>

        <button
          type="button"
          onClick={handleGoogleSignIn}
          disabled={loading}
          className="flex w-full items-center justify-center gap-3 rounded-xl border border-slate-300 px-4 py-3 text-sm font-medium hover:border-teal-200 hover:bg-teal-50 hover:text-teal-800 disabled:opacity-60"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="h-5 w-5"
          >
            <path
              fill="#4285F4"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.1 5.1 0 0 1-2.2 3.31v2.77h3.57c2.08-1.92 3.27-4.75 3.27-8.09Z"
            />
            <path
              fill="#34A853"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.25 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.15v2.84A11 11 0 0 0 12 23Z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.15a11 11 0 0 0 0 9.88l3.69-2.84Z"
            />
            <path
              fill="#EA4335"
              d="M12 5.37c1.62 0 3.06.56 4.21 1.66l3.15-3.15C17.45 2.1 14.97 1 12 1a11 11 0 0 0-9.85 6.06l3.69 2.84C6.71 7.3 9.14 5.37 12 5.37Z"
            />
          </svg>
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
              aria-live="polite"
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
          {mode === "signup" ? "Already have an account?" : "New to HouseholdHQ?"}{" "}
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
      </section>}
      </div>
    </main>
  );
}
