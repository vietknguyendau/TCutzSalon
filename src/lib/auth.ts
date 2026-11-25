import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getStore, isDemoMode } from "./data";
import type { DataStore } from "./data/store";
import type { Salon } from "./domain/types";
import { env } from "./env";

export type StaffRole = "owner" | "manager" | "stylist" | "receptionist";
export interface StaffContext {
  store: DataStore;
  salon: Salon;
  userId?: string;
  role: StaffRole;
  demo: boolean;
}

/**
 * Resolves the signed-in staff member and their salon.
 * Demo mode: acts as the demo salon owner with synthetic data (clearly bannered in the UI).
 * Supabase mode: requires a session; salon comes from salon_memberships (RLS-protected).
 */
export const getStaffContext = cache(async (): Promise<StaffContext> => {
  const store = await getStore("staff");
  if (isDemoMode()) {
    const salon = await store.getSalonBySlug(env().DEFAULT_SALON_SLUG);
    if (!salon) throw new Error("Demo salon missing");
    return { store, salon, role: "owner", demo: true };
  }
  const { supabaseUser } = await import("./supabase/clients");
  const sb = await supabaseUser();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) redirect("/login");
  const { data: membership } = await sb
    .from("salon_memberships")
    .select("salon_id, role")
    .eq("user_id", auth.user.id)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (!membership) redirect("/login?error=no_salon");
  const salon = await store.getSalonById(membership.salon_id);
  if (!salon) redirect("/login?error=no_salon");
  return { store, salon, userId: auth.user.id, role: membership.role as StaffRole, demo: false };
});

export function requireRole(ctx: StaffContext, roles: StaffRole[]) {
  if (!roles.includes(ctx.role)) throw new Error("FORBIDDEN");
}
