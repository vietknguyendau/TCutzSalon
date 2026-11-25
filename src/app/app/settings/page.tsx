import { getStaffContext } from "@/lib/auth";
import { Card } from "@/components/ui/primitives";
import { formatPhoneUS } from "@/lib/phone";
import { SalonProfileForm } from "@/components/app/salon-profile-form";
import { readDemoBranding } from "@/lib/data/demo-branding";
import { DEMO_BRAND_PARAM, encodeProfile } from "@/lib/salon-profile";
import { env } from "@/lib/env";

export const metadata = { title: "Settings" };
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default async function SettingsPage() {
  const { salon, demo, role } = await getStaffContext();
  const s = salon.settings;
  const branding = demo ? await readDemoBranding() : null;
  const app = env().NEXT_PUBLIC_APP_URL;
  const shareLinks = branding
    ? {
        booking: `${app}/book/${salon.slug}?${DEMO_BRAND_PARAM}=${encodeProfile(branding)}`,
        dashboard: `${app}/app/today?${DEMO_BRAND_PARAM}=${encodeProfile(branding)}`,
      }
    : undefined;
  const canEdit = role === "owner" || role === "manager";
  return (
    <div className="max-w-3xl">
      <h1 className="mb-5 font-display text-3xl">Settings</h1>
      {canEdit && (
        <Card className="mb-4 p-5">
          <h2 className="mb-1 text-lg font-semibold">Salon profile</h2>
          <p className="mb-4 text-sm text-ink-600">Change these any time — the dashboard, booking page and texts update right away.</p>
          <SalonProfileForm
            demo={demo}
            shareLinks={shareLinks}
            initial={{ name: salon.name, ownerFirstName: salon.ownerFirstName, ownerTitleVi: salon.ownerTitleVi, phone: formatPhoneUS(salon.phone), address: salon.address }}
          />
        </Card>
      )}
      <Card className="mb-4 p-5">
        <h2 className="mb-3 text-lg font-semibold">Salon</h2>
        <dl className="grid gap-2 text-[15px] sm:grid-cols-2">
          <Item k="Name" v={salon.name} />
          <Item k="Phone" v={formatPhoneUS(salon.phone)} />
          <Item k="Address" v={salon.address} />
          <Item k="Time zone" v={salon.timezone} />
          <Item k="Booking link" v={`/book/${salon.slug}`} />
          <Item k="Mode" v={demo ? "Demo (synthetic data)" : "Live"} />
        </dl>
      </Card>
      <Card className="mb-4 p-5">
        <h2 className="mb-3 text-lg font-semibold">Business hours</h2>
        <dl className="grid grid-cols-[7rem_1fr] gap-y-1 text-[15px]">
          {DAYS.map((d, i) => {
            const h = s.businessHours[i as 0] ?? [];
            return [<dt key={d} className="font-medium">{d}</dt>, <dd key={`${d}v`}>{h.length ? h.map((r) => `${r.open}–${r.close}`).join(", ") : "Closed"}</dd>];
          })}
        </dl>
      </Card>
      <Card className="p-5">
        <h2 className="mb-3 text-lg font-semibold">Booking rules</h2>
        <dl className="grid gap-2 text-[15px] sm:grid-cols-2">
          <Item k="Time slots every" v={`${s.slotIntervalMinutes} min`} />
          <Item k="Minimum notice" v={`${s.minBookingNoticeMinutes} min`} />
          <Item k="Book up to" v={`${s.maxAdvanceDays} days ahead`} />
          <Item k="Manage link valid" v={`${s.manageLinkTtlDays} days`} />
          <Item k="Languages" v={s.supportedLanguages.map((l) => (l === "vi" ? "Vietnamese" : "English")).join(", ")} />
        </dl>
      </Card>
      <p className="mt-4 text-sm text-ink-400">Editing hours and booking rules in the app comes after the owner discovery session. In the demo these are typical barbershop defaults; for a real salon, confirm them with the owner.</p>
    </div>
  );
}

function Item({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold tracking-wide text-ink-400 uppercase">{k}</dt>
      <dd className="font-medium">{v}</dd>
    </div>
  );
}
