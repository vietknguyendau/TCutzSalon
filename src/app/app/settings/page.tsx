import { getStaffContext } from "@/lib/auth";
import { Card } from "@/components/ui/primitives";
import { formatPhoneUS } from "@/lib/phone";

export const metadata = { title: "Settings" };
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default async function SettingsPage() {
  const { salon, demo } = await getStaffContext();
  const s = salon.settings;
  return (
    <div className="max-w-3xl">
      <h1 className="mb-5 font-display text-3xl">Settings</h1>
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
      <p className="mt-4 text-sm text-ink-400">Editing these in the app comes after the owner discovery session. Values come from tcutz-salon.com and must be confirmed with the owner.</p>
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
