"use client";

import { onAuthStateChanged } from "firebase/auth";
import { useCallback, useEffect, useRef, useState } from "react";
import { auth, db } from "@/lib/firebase";
import { getHouseholdsForUser } from "@/lib/households";
import type { HouseholdMembership } from "@/lib/types";

export function useHouseholds() {
  const [uid, setUid] = useState<string | null>(null);
  const [activeHouseholdId, setActiveHouseholdId] = useState("");
  const [households, setHouseholds] = useState<HouseholdMembership[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const requestVersion = useRef(0);

  const load = useCallback(async (userUid: string) => {
    const version = ++requestVersion.current;
    setLoading(true);
    setError("");
    setHouseholds([]);

    try {
      const results = await getHouseholdsForUser(db, userUid);
      if (version === requestVersion.current) setHouseholds(results);
    } catch (cause) {
      if (version === requestVersion.current) {
        setError(cause instanceof Error ? cause.message : "Could not load your households.");
      }
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      const version = ++requestVersion.current;
      setUid(user?.uid ?? null);
      let savedHouseholdId = "";
      if (user) {
        try {
          savedHouseholdId = window.localStorage.getItem(`household-hq.active-household:${user.uid}`) ?? "";
        } catch {
          // The household list still loads if browser storage is unavailable.
        }
      }
      setActiveHouseholdId(savedHouseholdId);
      setHouseholds([]);
      setError("");

      if (!user) {
        setLoading(false);
        return;
      }

      setLoading(true);
      void getHouseholdsForUser(db, user.uid)
        .then((results) => {
          if (version === requestVersion.current) setHouseholds(results);
        })
        .catch((cause: unknown) => {
          if (version === requestVersion.current) {
            setError(cause instanceof Error ? cause.message : "Could not load your households.");
          }
        })
        .finally(() => {
          if (version === requestVersion.current) setLoading(false);
        });
    });

    return () => {
      requestVersion.current += 1;
      unsubscribe();
    };
  }, []);

  const retry = useCallback(() => {
    if (uid) return load(uid);
    return Promise.resolve();
  }, [load, uid]);

  const selectHousehold = useCallback((householdId: string) => {
    if (!uid) return;
    try {
      window.localStorage.setItem(`household-hq.active-household:${uid}`, householdId);
    } catch {
      // Keep the selection for this page session even if persistence is blocked.
    }
    setActiveHouseholdId(householdId);
  }, [uid]);

  return { uid, households, activeHouseholdId, loading, error, retry, selectHousehold };
}
