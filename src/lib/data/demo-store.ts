// In-memory demo store with SYNTHETIC data. Clearly labeled as demo throughout the UI.
// State lives in one server process (resets on redeploy/cold start) — fine for demos, never for real bookings.

import { randomUUID } from "node:crypto";
import type { Appointment, Customer, HaircutHistoryEntry, HaircutProfile, Salon, Service, Staff } from "../domain/types";
import { isActiveStatus } from "../domain/types";
import { canTransition } from "../domain/status";
import { checkSlot, type BusyBlock } from "../scheduling/engine";
import { addMinutes, localDateOf, localToUtc, hhmmToMinutes, addDays } from "../scheduling/time";
import {
  DEMO_APPOINTMENTS,
  buildCustomers,
  buildHaircutHistory,
  buildHaircutProfiles,
  fid,
  tcutzSalon,
  tcutzServices,
  tcutzStaff,
} from "./fixtures";
import type { AppointmentPatch, CreateAppointmentInput, DataStore, NewCustomer, StoreResult, VerificationRecord } from "./store";

interface DemoState {
  salons: Salon[];
  services: Service[];
  staff: Staff[];
  customers: Customer[];
  profiles: HaircutProfile[];
  history: HaircutHistoryEntry[];
  appointments: Appointment[];
  verifications: VerificationRecord[];
}

function buildState(now = new Date()): DemoState {
  const tz = tcutzSalon.timezone;
  const today = localDateOf(now, tz);
  const svcById = new Map(tcutzServices.map((s) => [s.id, s]));
  const appointments: Appointment[] = DEMO_APPOINTMENTS.map((a) => {
    const lines = a.serviceIds.map((id) => svcById.get(id)!);
    const staff = tcutzStaff.find((s) => s.id === a.staffId)!;
    const duration = lines.reduce(
      (sum, s) => sum + (staff.services.find((l) => l.serviceId === s.id)?.durationOverrideMinutes ?? s.durationMinutes),
      0,
    );
    const cleanup = Math.max(0, ...lines.map((s) => s.cleanupMinutes));
    const start = localToUtc(addDays(today, a.dayOffset), hhmmToMinutes(a.time), tz);
    const end = addMinutes(start, duration);
    const price = lines.reduce((s, l) => s + l.priceCents, 0);
    return {
      id: fid(6, a.n),
      salonId: tcutzSalon.id,
      customerId: a.customerN ? fid(4, a.customerN) : undefined,
      staffId: a.staffId,
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
      blockedUntil: addMinutes(end, cleanup).toISOString(),
      status: a.status,
      source: a.source,
      estimatedPriceCents: price,
      finalPriceCents: a.status === "completed" ? price : undefined,
      services: lines.map((s) => ({ serviceId: s.id, name: s.nameEn, priceCents: s.priceCents, priceType: s.priceType, durationMinutes: s.durationMinutes })),
      customerNote: a.note,
      isDemo: true,
      createdAt: addMinutes(start, -60 * 24 * 3).toISOString(),
    };
  });
  return {
    salons: [tcutzSalon],
    services: structuredClone(tcutzServices),
    staff: structuredClone(tcutzStaff),
    customers: buildCustomers(today),
    profiles: buildHaircutProfiles(today),
    history: buildHaircutHistory(today),
    appointments,
    verifications: [],
  };
}

const g = globalThis as unknown as { __demoState?: { state: DemoState; day: string } };
function state(): DemoState {
  const day = localDateOf(new Date(), tcutzSalon.timezone);
  // Rebuild each new local day so "today" always has sample appointments.
  if (!g.__demoState || g.__demoState.day !== day) g.__demoState = { state: buildState(), day };
  return g.__demoState.state;
}
export function resetDemoState(now?: Date) {
  g.__demoState = { state: buildState(now), day: localDateOf(now ?? new Date(), tcutzSalon.timezone) };
}

const clone = <T>(v: T): T => structuredClone(v);

function busyFor(s: DemoState, salonId: string, excludeId?: string): BusyBlock[] {
  return s.appointments
    .filter((a) => a.salonId === salonId && isActiveStatus(a.status) && a.id !== excludeId)
    .map((a) => ({ staffId: a.staffId, start: new Date(a.startsAt), end: new Date(a.blockedUntil), kind: "appointment" as const }));
}

export class DemoStore implements DataStore {
  readonly mode = "demo" as const;

  async getSalonBySlug(slug: string) {
    return clone(state().salons.find((x) => x.slug === slug) ?? null);
  }
  async getSalonById(id: string) {
    return clone(state().salons.find((x) => x.id === id) ?? null);
  }
  async listServices(salonId: string) {
    return clone(state().services.filter((x) => x.salonId === salonId).sort((a, b) => a.sortOrder - b.sortOrder));
  }
  async listStaff(salonId: string) {
    return clone(state().staff.filter((x) => x.salonId === salonId).sort((a, b) => a.sortOrder - b.sortOrder));
  }
  async listBusy(salonId: string, from: Date, to: Date) {
    return busyFor(state(), salonId).filter((b) => b.start < to && b.end > from);
  }
  async listAppointments(salonId: string, from: Date, to: Date) {
    return clone(
      state()
        .appointments.filter((a) => a.salonId === salonId && new Date(a.startsAt) < to && new Date(a.endsAt) > from)
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    );
  }
  async getAppointment(salonId: string, id: string) {
    return clone(state().appointments.find((a) => a.salonId === salonId && a.id === id) ?? null);
  }
  async listCustomerAppointments(salonId: string, customerId: string) {
    return clone(
      state()
        .appointments.filter((a) => a.salonId === salonId && a.customerId === customerId)
        .sort((a, b) => b.startsAt.localeCompare(a.startsAt)),
    );
  }

  async findByIdempotencyKey(salonId: string, key: string) {
    return clone(state().appointments.find((a) => a.salonId === salonId && a.idempotencyKey === key) ?? null);
  }

  // Synchronous critical section (no awaits) → atomic within the process, like the DB advisory lock.
  async createAppointment(input: CreateAppointmentInput): Promise<StoreResult<{ appointment: Appointment; created: boolean }>> {
    const s = state();
    const existing = s.appointments.find((a) => a.salonId === input.salonId && a.idempotencyKey === input.idempotencyKey);
    if (existing) return { ok: true, value: { appointment: clone(existing), created: false } };

    const salon = s.salons.find((x) => x.id === input.salonId);
    const staff = s.staff.find((x) => x.id === input.staffId && x.salonId === input.salonId && x.isActive);
    if (!salon) return { ok: false, code: "NOT_FOUND" };
    if (!staff) return { ok: false, code: "INVALID_STAFF" };
    if (input.customerId && !s.customers.some((c) => c.id === input.customerId && c.salonId === input.salonId))
      return { ok: false, code: "INVALID_CUSTOMER" };
    const lines = input.serviceIds.map((id) => s.services.find((x) => x.id === id && x.salonId === input.salonId && x.isActive));
    if (lines.length === 0 || lines.some((l) => !l)) return { ok: false, code: "INVALID_SERVICE" };
    const svcs = lines as Service[];
    if (svcs.some((sv) => !staff.services.some((l) => l.serviceId === sv.id))) return { ok: false, code: "STAFF_NOT_QUALIFIED" };

    const [primary, ...extras] = svcs;
    const extraMinutes = extras.reduce(
      (sum, sv) => sum + (staff.services.find((l) => l.serviceId === sv.id)?.durationOverrideMinutes ?? sv.durationMinutes),
      0,
    );
    const cleanup = Math.max(...svcs.map((x) => x.cleanupMinutes));
    const res = checkSlot(
      { salon, staff: s.staff, busy: busyFor(s, input.salonId), now: new Date() },
      { service: { ...primary, cleanupMinutes: cleanup }, extraMinutes, staffId: staff.id, start: input.startsAt, channel: "manual" },
    );
    if (!res.ok) return { ok: false, code: res.reason === "CONFLICT" ? "SLOT_TAKEN" : "STAFF_NOT_QUALIFIED" };

    const appt: Appointment = {
      id: randomUUID(),
      salonId: input.salonId,
      customerId: input.customerId,
      staffId: staff.id,
      startsAt: input.startsAt.toISOString(),
      endsAt: res.end.toISOString(),
      blockedUntil: res.blockedUntil.toISOString(),
      status: input.initialStatus ?? (svcs.some((x) => x.requiresApproval) ? "pending_approval" : "booked"),
      source: input.source,
      idempotencyKey: input.idempotencyKey,
      estimatedPriceCents: svcs.reduce((sum, x) => sum + x.priceCents, 0),
      services: svcs.map((x) => ({
        serviceId: x.id,
        name: x.nameEn,
        priceCents: x.priceCents,
        priceType: x.priceType,
        durationMinutes: staff.services.find((l) => l.serviceId === x.id)?.durationOverrideMinutes ?? x.durationMinutes,
      })),
      customerNote: input.customerNote,
      isDemo: true,
      createdAt: new Date().toISOString(),
    };
    s.appointments.push(appt);
    return { ok: true, value: { appointment: clone(appt), created: true } };
  }

  async updateAppointment(salonId: string, id: string, patch: AppointmentPatch): Promise<StoreResult<Appointment>> {
    const s = state();
    const a = s.appointments.find((x) => x.salonId === salonId && x.id === id);
    if (!a) return { ok: false, code: "NOT_FOUND" };
    if (patch.status && patch.status !== a.status && !canTransition(a.status, patch.status))
      return { ok: false, code: "INVALID_TRANSITION" };
    if (patch.startsAt || patch.staffId) {
      const start = patch.startsAt ?? new Date(a.startsAt);
      const staffId = patch.staffId ?? a.staffId;
      const dur = new Date(a.endsAt).getTime() - new Date(a.startsAt).getTime();
      const cleanup = new Date(a.blockedUntil).getTime() - new Date(a.endsAt).getTime();
      const blocked = new Date(start.getTime() + dur + cleanup);
      const clash = busyFor(s, salonId, a.id).some((b) => b.staffId === staffId && b.start < blocked && start < b.end);
      if (clash) return { ok: false, code: "SLOT_TAKEN" };
      a.startsAt = start.toISOString();
      a.endsAt = new Date(start.getTime() + dur).toISOString();
      a.blockedUntil = blocked.toISOString();
      a.staffId = staffId;
    }
    if (patch.status) {
      a.status = patch.status;
      if (patch.status === "canceled") a.canceledAt = new Date().toISOString();
    }
    if (patch.finalPriceCents !== undefined) a.finalPriceCents = patch.finalPriceCents;
    if (patch.internalNote !== undefined) a.internalNote = patch.internalNote;
    return { ok: true, value: clone(a) };
  }

  async getCustomer(salonId: string, id: string) {
    return clone(state().customers.find((c) => c.salonId === salonId && c.id === id) ?? null);
  }
  async findCustomersByPhone(salonId: string, phone: string) {
    return clone(state().customers.filter((c) => c.salonId === salonId && c.phoneE164 === phone));
  }
  async searchCustomers(salonId: string, query: string) {
    const q = query.trim().toLowerCase();
    const digits = q.replace(/\D/g, "");
    return clone(
      state()
        .customers.filter((c) => c.salonId === salonId)
        .filter(
          (c) =>
            !q ||
            `${c.firstName} ${c.lastName ?? ""}`.toLowerCase().includes(q) ||
            (digits.length >= 3 && (c.phoneE164 ?? "").includes(digits)),
        )
        .sort((a, b) => (b.lastVisitAt ?? "").localeCompare(a.lastVisitAt ?? "")),
    );
  }
  async createCustomer(input: NewCustomer) {
    const c: Customer = {
      id: randomUUID(),
      salonId: input.salonId,
      firstName: input.firstName,
      lastName: input.lastName,
      phoneE164: input.phoneE164,
      preferredLanguage: input.preferredLanguage,
      completedVisits: 0,
      lifetimeSpendCents: 0,
      noShowCount: 0,
      cancelCount: 0,
      smsTransactionalConsent: input.smsTransactionalConsent,
      smsMarketingConsent: input.smsMarketingConsent ?? false,
      photoConsent: false,
      isSynthetic: true,
      createdAt: new Date().toISOString(),
    };
    state().customers.push(c);
    return clone(c);
  }
  async recordCompletedVisit(salonId: string, customerId: string, priceCents: number, at: Date) {
    const c = state().customers.find((x) => x.salonId === salonId && x.id === customerId);
    if (!c) return;
    c.completedVisits += 1;
    c.lifetimeSpendCents += priceCents;
    c.lastVisitAt = at.toISOString();
    c.firstVisitAt ??= at.toISOString();
  }

  async getHaircutProfile(salonId: string, customerId: string) {
    const s = state();
    if (!s.customers.some((c) => c.salonId === salonId && c.id === customerId)) return null;
    return clone(s.profiles.find((p) => p.customerId === customerId) ?? null);
  }
  async listHaircutHistory(salonId: string, customerId: string) {
    const s = state();
    if (!s.customers.some((c) => c.salonId === salonId && c.id === customerId)) return [];
    return clone(s.history.filter((h) => h.customerId === customerId).sort((a, b) => b.cutOn.localeCompare(a.cutOn)));
  }
  async saveHaircutVisit(
    salonId: string,
    profile: Omit<HaircutProfile, "updatedAt">,
    visit: { cutOn: string; staffId?: string; appointmentId?: string; customerFeedback?: string },
  ) {
    const s = state();
    if (!s.customers.some((c) => c.salonId === salonId && c.id === profile.customerId)) throw new Error("NOT_FOUND");
    const now = new Date().toISOString();
    s.profiles = s.profiles.filter((p) => p.customerId !== profile.customerId);
    s.profiles.push({ ...profile, updatedAt: now });
    const { customerId, ...snapshot } = profile;
    s.history.push({ id: randomUUID(), customerId, snapshot, photos: [], createdAt: now, ...visit });
  }

  async recordConsent(salonId: string, customerId: string, consent: "photo" | "sms_transactional" | "sms_marketing", granted: boolean) {
    const c = state().customers.find((x) => x.salonId === salonId && x.id === customerId);
    if (!c) return;
    if (consent === "photo") c.photoConsent = granted;
    if (consent === "sms_transactional") c.smsTransactionalConsent = granted;
    if (consent === "sms_marketing") c.smsMarketingConsent = granted;
  }
  async addHaircutPhoto(salonId: string, customerId: string, angle: "front" | "side" | "back", url: string): Promise<StoreResult<{ id: string }>> {
    const s = state();
    const c = s.customers.find((x) => x.salonId === salonId && x.id === customerId);
    if (!c) return { ok: false, code: "NOT_FOUND" };
    if (!c.photoConsent) return { ok: false, code: "INVALID_CUSTOMER" };
    let entry = s.history.filter((h) => h.customerId === customerId).sort((a, b) => b.cutOn.localeCompare(a.cutOn))[0];
    const today = localDateOf(new Date(), tcutzSalon.timezone);
    if (!entry || entry.cutOn !== today) {
      const profile = s.profiles.find((p) => p.customerId === customerId);
      const { customerId: _c, updatedAt: _u, ...snapshot } = profile ?? { customerId, updatedAt: "" };
      void _c; void _u;
      entry = { id: randomUUID(), customerId, cutOn: today, snapshot, photos: [], createdAt: new Date().toISOString() };
      s.history.push(entry);
    }
    const id = randomUUID();
    entry.photos = entry.photos.filter((p) => p.angle !== angle).concat({ id, angle, url });
    return { ok: true, value: { id } };
  }

  async saveVerification(rec: Omit<VerificationRecord, "id" | "attempts">) {
    const v = { ...rec, id: randomUUID(), attempts: 0 };
    state().verifications.push(v);
    return clone(v);
  }
  async latestVerification(salonId: string, phone: string) {
    const list = state().verifications.filter((v) => v.salonId === salonId && v.phoneE164 === phone);
    return clone(list.at(-1) ?? null);
  }
  async updateVerification(id: string, patch: Partial<Pick<VerificationRecord, "attempts" | "verifiedAt">>) {
    const v = state().verifications.find((x) => x.id === id);
    if (v) Object.assign(v, patch);
  }
}
