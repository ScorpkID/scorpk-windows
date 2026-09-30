import type { SupabaseClient } from "@supabase/supabase-js";

/** Pro = suscripción con plan "pro" y estado active/trialing (misma regla que el servidor de IA). */
export function isProSubscription(row: { plan?: string | null; status?: string | null } | null): boolean {
  return row?.plan === "pro" && (row.status === "active" || row.status === "trialing");
}

/** Solo lectura: el cobro se hace en scorpk.tech/pricing. Ante cualquier fallo se asume Free. */
export async function fetchIsPro(client: SupabaseClient, userId: string): Promise<boolean> {
  try {
    const { data } = await client.from("subscriptions").select("plan, status").eq("user_id", userId).maybeSingle();
    return isProSubscription(data);
  } catch {
    return false;
  }
}
