import { Suspense } from "react";
import HouseholdSetupPage from "./setup-page";

export const instant = false;

export default function Page() {
  return (
    <Suspense fallback={<main className="flex min-h-screen items-center justify-center bg-[#f3f7f5] text-slate-600">Loading household setup…</main>}>
      <HouseholdSetupPage />
    </Suspense>
  );
}
