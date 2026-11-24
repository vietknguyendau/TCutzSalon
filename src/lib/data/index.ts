import "server-only";
import { connection } from "next/server";
import { env } from "../env";
import { DemoStore } from "./demo-store";
import type { DataStore } from "./store";

let demo: DemoStore | null = null;

/**
 * "public": validated public endpoints (booking page, voice tools) — service client.
 * "staff":  dashboard — user-scoped client so RLS enforces tenant isolation.
 */
export async function getStore(scope: "public" | "staff"): Promise<DataStore> {
  // Booking data is live, per request — never prerendered or cached.
  await connection();
  if (env().DATA_MODE === "demo") return (demo ??= new DemoStore());
  const [{ SupabaseStore }, { supabaseAdmin, supabaseUser }] = await Promise.all([
    import("./supabase-store"),
    import("../supabase/clients"),
  ]);
  const admin = supabaseAdmin();
  return new SupabaseStore(scope === "staff" ? await supabaseUser() : admin, admin);
}

export function isDemoMode(): boolean {
  return env().DATA_MODE === "demo";
}
