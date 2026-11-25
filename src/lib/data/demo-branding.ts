import type { Salon, Staff } from "../domain/types";
import { DEMO_BRAND_COOKIE, decodeProfile, type SalonProfile } from "../salon-profile";
import { STAFF_OWNER } from "./fixtures";

/** Reads this browser's demo branding (set from Settings or a share link). Null outside a request. */
export async function readDemoBranding(): Promise<SalonProfile | null> {
  try {
    const { cookies } = await import("next/headers");
    return decodeProfile((await cookies()).get(DEMO_BRAND_COOKIE)?.value);
  } catch {
    return null; // not in a request scope (tests, scripts)
  }
}

export function brandSalon(salon: Salon, p: SalonProfile | null): Salon {
  if (!p) return salon;
  return {
    ...salon,
    name: p.name,
    ownerFirstName: p.ownerFirstName ?? salon.ownerFirstName,
    ownerTitleVi: p.ownerTitleVi,
    phone: p.phone ?? salon.phone,
    address: p.address ?? salon.address,
  };
}

export function brandStaff(staff: Staff[], p: SalonProfile | null): Staff[] {
  if (!p?.ownerFirstName) return staff;
  return staff.map((s) => (s.id === STAFF_OWNER ? { ...s, displayName: p.ownerFirstName! } : s));
}
