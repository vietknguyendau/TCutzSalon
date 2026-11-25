import { CalendarCheck, CircleDollarSign, Clock3, UserX } from "lucide-react";
import { getStaffContext } from "@/lib/auth";
import { dayStats, loadRange, serviceOptions, staffOptions, todayLocal, haircutSummary, type EnrichedAppointment } from "@/lib/dashboard";
import { formatLocalTime } from "@/lib/scheduling/time";
import { formatMoney, formatPrice } from "@/lib/money";
import { STATUS_TRANSITIONS, primaryNextStatus } from "@/lib/domain/status";
import { AppointmentCard, type CardData } from "@/components/app/appointment-card";
import { QuickBookButtons, type Prefill } from "@/components/app/quick-book";
import { Card } from "@/components/ui/primitives";
import { formatDateLong } from "@/lib/i18n/dict";
import { CallbackList } from "@/components/app/callback-list";
import { timeAgo } from "@/lib/time-ago";

export const metadata = { title: "Today" };

function toCard(e: EnrichedAppointment, tz: string, now: Date): CardData {
  const a = e.appt;
  return {
    id: a.id,
    time: formatLocalTime(a.startsAt, tz),
    endTime: formatLocalTime(a.endsAt, tz),
    status: a.status,
    source: a.source,
    customerId: e.customer?.id,
    customerName: e.customer ? [e.customer.firstName, e.customer.lastName].filter(Boolean).join(" ") : "Walk-in guest",
    phone: e.customer?.phoneE164,
    isReturning: e.isReturning,
    visits: e.customer?.completedVisits ?? 0,
    haircut: e.isReturning ? haircutSummary(e.haircut) : undefined,
    services: a.services.map((s) => s.name).join(" + "),
    price: formatPrice(a.finalPriceCents ?? a.estimatedPriceCents, a.services[0]?.priceType),
    staffName: e.staff?.displayName,
    staffColor: e.staff?.color,
    note: a.customerNote,
    isNow: new Date(a.startsAt) <= now && now < new Date(a.endsAt) && !["canceled", "no_show", "completed"].includes(a.status),
    next: primaryNextStatus(a.status),
    allowed: STATUS_TRANSITIONS[a.status],
  };
}

export default async function TodayPage(props: PageProps<"/app/today">) {
  const ctx = await getStaffContext();
  const sp = await props.searchParams;
  const today = todayLocal(ctx);
  const [{ appointments, staff, services }, callbacks] = await Promise.all([
    loadRange(ctx, today, 1),
    ctx.store.listCallbacks(ctx.salon.id, "open"),
  ]);
  const stats = dayStats(appointments);
  const now = new Date();
  const cards = appointments.map((e) => toCard(e, ctx.salon.timezone, now));
  const upcoming = cards.filter((c) => !["completed", "canceled", "no_show"].includes(c.status));
  const finished = cards.filter((c) => ["completed", "canceled", "no_show"].includes(c.status));

  // "Same as Last Time" deep link from a customer profile: /app/today?book=<customerId>
  let prefill: Prefill | undefined;
  if (typeof sp.book === "string") {
    const c = await ctx.store.getCustomer(ctx.salon.id, sp.book);
    if (c)
      prefill = {
        mode: "book",
        customer: { id: c.id, name: [c.firstName, c.lastName].filter(Boolean).join(" "), phone: c.phoneE164, usualServiceId: c.usualServiceId, preferredStaffId: c.preferredStaffId },
      };
  }

  return (
    <div>
      <header className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold tracking-wider text-gold-700 uppercase">Today</p>
          <h1 className="font-display text-3xl text-ink-950 sm:text-4xl">{formatDateLong(today, "en")}</h1>
        </div>
        <QuickBookButtons services={serviceOptions(services)} staff={staffOptions(staff)} today={today} timezone={ctx.salon.timezone} prefill={prefill} />
      </header>

      <CallbackList
        items={callbacks.map((c) => ({ id: c.id, name: c.name, phone: c.phoneE164, reason: c.reason, message: c.message, language: c.language, ago: timeAgo(c.createdAt) }))}
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={<CalendarCheck />} label="Appointments" value={String(stats.count)} sub={`${stats.remaining} still to come`} />
        <Stat icon={<Clock3 />} label="Est. revenue" value={formatMoney(stats.estimatedCents)} sub="starting prices" />
        <Stat icon={<CircleDollarSign />} label="Completed" value={formatMoney(stats.completedCents)} sub="recorded today" />
        <Stat icon={<UserX />} label="No-shows" value={String(stats.noShows)} />
      </div>

      <section aria-labelledby="up">
        <h2 id="up" className="mb-3 text-lg font-semibold text-ink-800">Up next</h2>
        {upcoming.length === 0 ? (
          <Card className="p-6 text-ink-600">Nothing else on the books today.</Card>
        ) : (
          <div className="grid gap-3">{upcoming.map((c) => <AppointmentCard key={c.id} c={c} />)}</div>
        )}
      </section>
      {finished.length > 0 && (
        <section aria-labelledby="done" className="mt-8">
          <h2 id="done" className="mb-3 text-lg font-semibold text-ink-800">Finished</h2>
          <div className="grid gap-3">{finished.map((c) => <AppointmentCard key={c.id} c={c} />)}</div>
        </section>
      )}
    </div>
  );
}

function Stat({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <Card className="p-4">
      <p className="flex items-center gap-2 text-sm font-medium text-ink-600 [&_svg]:size-4 [&_svg]:text-gold-600">
        {icon} {label}
      </p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-ink-950">{value}</p>
      {sub && <p className="text-xs text-ink-400">{sub}</p>}
    </Card>
  );
}
