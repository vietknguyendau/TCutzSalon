// Per-prospect demo branding WITHOUT code changes. Set any of these (e.g. in Vercel env vars or .env.local):
//   DEMO_SALON_NAME="Lan's Hair Studio"   DEMO_OWNER_NAME="Lan"   DEMO_OWNER_TITLE_VI="chị"
//   DEMO_SALON_PHONE="(612) 555-0142"     DEMO_SALON_ADDRESS="Eagan, MN"   DEMO_TIMEZONE="America/Chicago"
// Only affects the in-memory demo salon. Customers, phone numbers and appointments stay synthetic.

import type { Salon, Staff } from "../domain/types";
import { STAFF_OWNER } from "./fixtures";

type Env = Record<string, string | undefined>;

function e164(v: string | undefined): string | undefined {
  const d = (v ?? "").replace(/\D/g, "");
  const ten = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  return ten.length === 10 ? `+1${ten}` : undefined;
}

function validTz(tz: string | undefined): string | undefined {
  if (!tz) return undefined;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return undefined;
  }
}

const clean = (v: string | undefined, max: number) => v?.trim().slice(0, max) || undefined;

export function applyDemoOverrides(salon: Salon, staff: Staff[], env: Env = process.env): { salon: Salon; staff: Staff[] } {
  const name = clean(env.DEMO_SALON_NAME, 60);
  const owner = clean(env.DEMO_OWNER_NAME, 30);
  const s: Salon = {
    ...salon,
    name: name ?? salon.name,
    ownerFirstName: owner ?? salon.ownerFirstName,
    ownerTitleVi: clean(env.DEMO_OWNER_TITLE_VI, 10) ?? salon.ownerTitleVi,
    phone: e164(env.DEMO_SALON_PHONE) ?? salon.phone,
    address: clean(env.DEMO_SALON_ADDRESS, 120) ?? salon.address,
    timezone: validTz(env.DEMO_TIMEZONE) ?? salon.timezone,
  };
  const st = owner ? staff.map((x) => (x.id === STAFF_OWNER ? { ...x, displayName: owner } : x)) : staff;
  return { salon: s, staff: st };
}
