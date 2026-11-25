import { getStaffContext } from "@/lib/auth";
import { Card } from "@/components/ui/primitives";

export const metadata = { title: "Staff" };
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const fmt = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return `${((h + 11) % 12) + 1}${m ? `:${String(m).padStart(2, "0")}` : ""}${h < 12 ? "a" : "p"}`;
};

export default async function StaffPage() {
  const ctx = await getStaffContext();
  const staff = await ctx.store.listStaff(ctx.salon.id);
  return (
    <div>
      <h1 className="mb-5 font-display text-3xl">Staff</h1>
      <div className="grid gap-4 md:grid-cols-2">
        {staff.map((s) => (
          <Card key={s.id} className="p-5">
            <p className="flex items-center gap-2 text-xl font-semibold">
              <span className="size-4 rounded-full" style={{ background: s.color }} /> {s.displayName}
            </p>
            <p className="mb-3 text-sm text-ink-400">{s.services.length} services · {s.isBookableOnline ? "bookable online" : "not online"}</p>
            <dl className="grid grid-cols-[3rem_1fr] gap-y-1 text-[15px]">
              {DAYS.map((d, i) => {
                const h = s.workingHours[i as 0] ?? [];
                return [
                  <dt key={`${d}-l`} className="font-semibold text-ink-600">{d}</dt>,
                  <dd key={`${d}-v`} className={h.length ? "" : "text-ink-400"}>{h.length ? h.map((r) => `${fmt(r.open)}–${fmt(r.close)}`).join(", ") : "Off"}</dd>,
                ];
              })}
            </dl>
          </Card>
        ))}
      </div>
      <p className="mt-4 text-sm text-ink-400">Staff, hours and time-off editing in the app come after the owner discovery session.</p>
    </div>
  );
}
