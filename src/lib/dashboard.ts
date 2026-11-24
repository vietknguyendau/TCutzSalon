import "server-only";
import type { StaffContext } from "./auth";
import type { Appointment, Customer, HaircutProfile, Service, Staff } from "./domain/types";
import { isActiveStatus } from "./domain/types";
import { addDays, localDateOf, localDayBounds } from "./scheduling/time";

export interface EnrichedAppointment {
  appt: Appointment;
  customer?: Customer;
  haircut?: HaircutProfile | null;
  staff?: Staff;
  isReturning: boolean;
}

export function haircutSummary(p?: HaircutProfile | null): string | undefined {
  if (!p) return undefined;
  return [p.style, p.clipperGuard && `Guard ${p.clipperGuard}`, p.beard && `Beard: ${p.beard}`, p.colorFormula && `Color: ${p.colorFormula}`]
    .filter(Boolean)
    .join(" · ");
}

export function todayLocal(ctx: StaffContext) {
  return localDateOf(new Date(), ctx.salon.timezone);
}

export async function loadRange(ctx: StaffContext, fromDate: string, days: number) {
  const { store, salon } = ctx;
  const from = localDayBounds(fromDate, salon.timezone).start;
  const to = localDayBounds(addDays(fromDate, days - 1), salon.timezone).end;
  const [appts, staff, services] = await Promise.all([
    store.listAppointments(salon.id, from, to),
    store.listStaff(salon.id),
    store.listServices(salon.id),
  ]);
  const ids = [...new Set(appts.map((a) => a.customerId).filter(Boolean))] as string[];
  const customers = new Map<string, Customer>();
  const profiles = new Map<string, HaircutProfile | null>();
  await Promise.all(
    ids.map(async (id) => {
      const [c, p] = await Promise.all([store.getCustomer(salon.id, id), store.getHaircutProfile(salon.id, id)]);
      if (c) customers.set(id, c);
      profiles.set(id, p);
    }),
  );
  const enriched: EnrichedAppointment[] = appts.map((a) => {
    const c = a.customerId ? customers.get(a.customerId) : undefined;
    return {
      appt: a,
      customer: c,
      haircut: a.customerId ? profiles.get(a.customerId) : null,
      staff: staff.find((s) => s.id === a.staffId),
      isReturning: (c?.completedVisits ?? 0) > 0,
    };
  });
  return { appointments: enriched, staff, services };
}

export function dayStats(list: EnrichedAppointment[]) {
  const active = list.filter((e) => isActiveStatus(e.appt.status));
  const completed = list.filter((e) => e.appt.status === "completed");
  return {
    count: active.length,
    remaining: active.filter((e) => e.appt.status !== "completed").length,
    estimatedCents: active.reduce((s, e) => s + e.appt.estimatedPriceCents, 0),
    completedCents: completed.reduce((s, e) => s + (e.appt.finalPriceCents ?? e.appt.estimatedPriceCents), 0),
    noShows: list.filter((e) => e.appt.status === "no_show").length,
    bySource: active.reduce<Record<string, number>>((m, e) => ((m[e.appt.source] = (m[e.appt.source] ?? 0) + 1), m), {}),
  };
}

export function serviceOptions(services: Service[]) {
  return services
    .filter((s) => s.isActive)
    .map((s) => ({ id: s.id, name: s.nameEn, priceCents: s.priceCents, priceType: s.priceType, durationMinutes: s.durationMinutes }));
}
export function staffOptions(staff: Staff[]) {
  return staff.filter((s) => s.isActive).map((s) => ({ id: s.id, name: s.displayName, color: s.color, serviceIds: s.services.map((l) => l.serviceId) }));
}
