import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getStaffContext } from "@/lib/auth";
import { haircutSummary, todayLocal } from "@/lib/dashboard";
import { formatLocalTime, localDateOf } from "@/lib/scheduling/time";
import { formatPrice } from "@/lib/money";
import { formatPhoneUS } from "@/lib/phone";
import { formatDateLong } from "@/lib/i18n/dict";
import { STATUS_TRANSITIONS, primaryNextStatus } from "@/lib/domain/status";
import { Card, SOURCE_LABEL, StatusBadge } from "@/components/ui/primitives";
import { Reschedule } from "@/components/app/reschedule";
import { AppointmentCard } from "@/components/app/appointment-card";

export const metadata = { title: "Appointment" };

export default async function AppointmentPage(props: PageProps<"/app/appointments/[id]">) {
  const { id } = await props.params;
  const ctx = await getStaffContext();
  const tz = ctx.salon.timezone;
  const a = await ctx.store.getAppointment(ctx.salon.id, id);
  if (!a) notFound();
  const [customer, staff] = await Promise.all([a.customerId ? ctx.store.getCustomer(ctx.salon.id, a.customerId) : null, ctx.store.listStaff(ctx.salon.id)]);
  const haircut = customer ? await ctx.store.getHaircutProfile(ctx.salon.id, customer.id) : null;
  const st = staff.find((s) => s.id === a.staffId);
  const movable = !["completed", "canceled", "no_show", "in_progress"].includes(a.status);
  const qualified = staff.filter((s) => s.isActive && s.services.some((l) => l.serviceId === a.services[0]?.serviceId));

  return (
    <div className="max-w-3xl">
      <Link href="/app/calendar" className="mb-4 inline-flex h-11 items-center gap-1.5 text-ink-600"><ArrowLeft className="size-5" /> Calendar</Link>
      <h1 className="font-display text-3xl">{customer ? `${customer.firstName} ${customer.lastName ?? ""}` : "Walk-in guest"}</h1>
      <p className="mt-1 flex flex-wrap items-center gap-2 text-lg text-ink-700">
        {formatDateLong(localDateOf(a.startsAt, tz), "en")} · {formatLocalTime(a.startsAt, tz)}–{formatLocalTime(a.endsAt, tz)} <StatusBadge status={a.status} />
      </p>

      <div className="mt-5">
        <AppointmentCard
          c={{
            id: a.id, time: formatLocalTime(a.startsAt, tz), endTime: formatLocalTime(a.endsAt, tz), status: a.status, source: a.source,
            customerId: customer?.id, customerName: customer?.firstName ?? "Walk-in guest", phone: customer?.phoneE164,
            isReturning: (customer?.completedVisits ?? 0) > 0, visits: customer?.completedVisits ?? 0, haircut: haircutSummary(haircut),
            services: a.services.map((s) => s.name).join(" + "), price: formatPrice(a.estimatedPriceCents, a.services[0]?.priceType),
            staffName: st?.displayName, staffColor: st?.color, note: a.customerNote, isNow: false,
            next: primaryNextStatus(a.status), allowed: STATUS_TRANSITIONS[a.status],
          }}
        />
      </div>

      <Card className="mt-4 grid gap-1 p-5 text-[15px] sm:grid-cols-2">
        <p><span className="text-ink-400">Source:</span> {SOURCE_LABEL[a.source]}</p>
        <p><span className="text-ink-400">Phone:</span> {formatPhoneUS(customer?.phoneE164) || "—"}</p>
        <p><span className="text-ink-400">Booked:</span> {new Date(a.createdAt).toLocaleString("en-US", { timeZone: tz })}</p>
        <p><span className="text-ink-400">Stylist:</span> {st?.displayName}</p>
      </Card>

      {movable && a.services[0] && (
        <section className="mt-8">
          <h2 className="mb-3 text-xl font-semibold">Reschedule</h2>
          <Reschedule
            appointmentId={a.id}
            serviceId={a.services[0].serviceId}
            staff={qualified.map((s) => ({ id: s.id, name: s.displayName, color: s.color }))}
            staffId={a.staffId}
            today={todayLocal(ctx)}
            timezone={tz}
          />
        </section>
      )}
    </div>
  );
}
