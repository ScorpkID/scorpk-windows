import { useCallback, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { fetchIsPro } from "./plan";

export interface SessionState {
  loading: boolean;
  session: Session | null;
  isPro: boolean;
  refreshPlan: () => Promise<void>;
  signOut: () => Promise<void>;
}

/** Sesión de Supabase + plan del usuario (lectura de `subscriptions`). */
export function useSession(): SessionState {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [isPro, setIsPro] = useState(false);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id;
  const refreshPlan = useCallback(async () => {
    if (!supabase || !userId) {
      setIsPro(false);
      return;
    }
    setIsPro(await fetchIsPro(supabase, userId));
  }, [userId]);

  useEffect(() => {
    void refreshPlan();
  }, [refreshPlan]);

  const signOut = useCallback(async () => {
    await supabase?.auth.signOut();
  }, []);

  return { loading, session, isPro, refreshPlan, signOut };
}
