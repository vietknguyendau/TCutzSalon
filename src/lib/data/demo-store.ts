// In-memory demo store with SYNTHETIC data. Clearly labeled as demo throughout the UI.
// State lives in one server process (resets on redeploy/cold start) — fine for demos, never for real bookings.

import { randomUUID } from "node:crypto";
import type { Appointment, CallLog, CallbackRequest, Customer, HaircutHistoryEntry, HaircutProfile, NotificationRecord, Salon, Service, Staff } from "../domain/types";
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
  notifications: NotificationRecord[];
  calls: CallLog[];
  callbacks: CallbackRequest[];
  optOuts: Map<string, boolean>; // `${salonId}|${phone}`
  webhookEvents: Set<string>;
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
  // A little realistic Phase-2 history for today: one missed call that got a text, one landline call-back.
  const at = (hhmm: string) => localToUtc(today, hhmmToMinutes(hhmm), tz).toISOString();
  const calls: CallLog[] = [
    { id: randomUUID(), salonId: tcutzSalon.id, provider: "demo", externalCallId: "demo-call-1", fromE164: "+17635550166", language: "en", startedAt: at("10:12"), endedAt: at("10:12"), durationSeconds: 18, outcome: "missed", createdAt: at("10:12") },
    { id: randomUUID(), salonId: tcutzSalon.id, provider: "demo", externalCallId: "demo-call-2", fromE164: "+17635550102", language: "en", startedAt: at("11:05"), endedAt: at("11:06"), durationSeconds: 22, outcome: "missed", createdAt: at("11:05") },
  ];
  const notifications: NotificationRecord[] = [
    { id: randomUUID(), salonId: tcutzSalon.id, channel: "sms", category: "transactional", template: "missed_call_text_back", toAddress: "+17635550166", body: "Tcutz: Sorry we missed your call! Book here: https://book.tcutz-salon.com/?r=m or reply CALL for a call back. Reply STOP to opt out.", status: "test_mode", provider: "console", scheduledFor: at("10:12"), sentAt: at("10:12"), segments: 1, createdAt: at("10:12") },
  ];
  const callbacks: CallbackRequest[] = [
    { id: randomUUID(), salonId: tcutzSalon.id, customerId: fid(4, 3), phoneE164: "+17635550102", name: "Robert Anderson", reason: "landline_missed_call", language: "en", status: "open", createdAt: at("11:06") },
  ];
  return {
    notifications,
    calls,
    callbacks,
    optOuts: new Map(),
    webhookEvents: new Set(),
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

const g = globalThis as unknown as { __demoState?: { state: DemoState; day: string; pinned: boolean } };
function state(): DemoState {
  const day = localDateOf(new Date(), tcutzSalon.timezone);
  // Rebuild each new local day so "today" always has sample appointments (unless a test pinned the date).
  if (!g.__demoState || (!g.__demoState.pinned && g.__demoState.day !== day)) g.__demoState = { state: buildState(), day, pinned: false };
  return g.__demoState.state;
}
/** Tests: pass `now` to pin the demo calendar to that date. */
export function resetDemoState(now?: Date) {
  g.__demoState = { state: buildState(now), day: localDateOf(now ?? new Date(), tcutzSalon.timezone), pinned: !!now };
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
      attribution: input.attribution,
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

  async findSalonByProviderNumber(e164: string) {
    return clone(state().salons.find((x) => x.providerNumber === e164) ?? null);
  }
  async recordWebhookEvent(provider: string, externalId: string) {
    const k = `${provider}|${externalId}`;
    const s = state();
    if (s.webhookEvents.has(k)) return false;
    s.webhookEvents.add(k);
    return true;
  }
  async isOptedOut(salonId: string, phone: string) {
    return state().optOuts.get(`${salonId}|${phone}`) === true;
  }
  async setOptOut(salonId: string, phone: string, optedOut: boolean) {
    state().optOuts.set(`${salonId}|${phone}`, optedOut);
  }
  async lastNotificationAt(salonId: string, to: string, templates: string[]) {
    const hit = state()
      .notifications.filter((n) => n.salonId === salonId && n.toAddress === to && templates.includes(n.template) && n.status !== "failed" && n.status !== "suppressed")
      .sort((a, b) => b.scheduledFor.localeCompare(a.scheduledFor))[0];
    return hit ? new Date(hit.scheduledFor) : null;
  }
  async createNotification(n: Omit<NotificationRecord, "id" | "createdAt">) {
    const rec = { ...n, id: randomUUID(), createdAt: new Date().toISOString() };
    state().notifications.push(rec);
    return clone(rec);
  }
  async updateNotification(id: string, patch: Partial<NotificationRecord>) {
    const n = state().notifications.find((x) => x.id === id);
    if (n) Object.assign(n, patch);
  }
  async markNotificationByProviderId(providerMessageId: string, status: "delivered" | "failed", error?: string) {
    const n = state().notifications.find((x) => x.providerMessageId === providerMessageId);
    if (n) Object.assign(n, { status, error });
  }
  async listDueNotifications(now: Date, limit: number) {
    return clone(state().notifications.filter((n) => n.status === "queued" && new Date(n.scheduledFor) <= now).slice(0, limit));
  }
  async listNotifications(salonId: string, limit: number) {
    return clone(state().notifications.filter((n) => n.salonId === salonId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit));
  }
  async upsertCall(c: Omit<CallLog, "id" | "createdAt">) {
    const s = state();
    const existing = s.calls.find((x) => x.provider === c.provider && x.externalCallId === c.externalCallId);
    if (existing) {
      for (const [k, v] of Object.entries(c)) if (v !== undefined) (existing as unknown as Record<string, unknown>)[k] = v;
      return clone(existing);
    }
    const rec: CallLog = { ...c, id: randomUUID(), createdAt: new Date().toISOString() };
    s.calls.push(rec);
    return clone(rec);
  }
  async getCall(provider: string, externalCallId: string) {
    return clone(state().calls.find((x) => x.provider === provider && x.externalCallId === externalCallId) ?? null);
  }
  async listCalls(salonId: string, since: Date) {
    return clone(state().calls.filter((c) => c.salonId === salonId && new Date(c.createdAt) >= since).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  }
  async createCallback(c: Omit<CallbackRequest, "id" | "createdAt" | "status">) {
    const s = state();
    const open = s.callbacks.find((x) => x.salonId === c.salonId && x.phoneE164 === c.phoneE164 && x.status === "open");
    if (open) {
      if (c.message) open.message = open.message ? `${open.message}\n${c.message}` : c.message;
      if (c.reason === "customer_asked") open.reason = c.reason;
      return clone(open);
    }
    const rec: CallbackRequest = { ...c, id: randomUUID(), status: "open", createdAt: new Date().toISOString() };
    s.callbacks.push(rec);
    return clone(rec);
  }
  async listCallbacks(salonId: string, status: CallbackRequest["status"]) {
    return clone(state().callbacks.filter((c) => c.salonId === salonId && c.status === status).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  }
  async resolveCallback(salonId: string, id: string, status: "done" | "dismissed") {
    const c = state().callbacks.find((x) => x.salonId === salonId && x.id === id);
    if (c) {
      c.status = status;
      c.resolvedAt = new Date().toISOString();
    }
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
