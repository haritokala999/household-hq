import { Suspense } from "react";
import HomePage from "./home-page";

export const instant = false;

export default function Page() {
  return (
    <Suspense fallback={<main className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-600">Loading Household HQ…</main>}>
      <HomePage />
    </Suspense>
  );
}
