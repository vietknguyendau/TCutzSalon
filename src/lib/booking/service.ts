import "server-only";
// The ONE booking service. Website, dashboard, and (Phase 2) the AI receptionist all call these
// functions — never the store directly — so every channel follows identical rules.

import { randomInt, timingSafeEqual } from "node:crypto";
import type { Appointment, AppointmentStatus, Customer, Lang, Salon, Service } from "../domain/types";
import { checkSlot, getAvailability, type AvailableSlot, type Channel } from "../scheduling/engine";
import { addDays, addMinutes, formatLocalTime, localDateOf, localDayBounds } from "../scheduling/time";
import type { BookingErrorCode, DataStore } from "../data/store";
import { env, signingSecret } from "../env";
import { hashCode, signToken, verifyToken } from "../tokens";
import { smsProviderFor } from "../providers/sms";
import type { PublicBookingBody } from "../validation";
import { formatPrice } from "../money";

export type BookingFailure = BookingErrorCode | "SLOT_UNAVAILABLE" | "VERIFICATION_REQUIRED" | "SERVICE_NOT_FOUND";
export type Result<T> = { ok: true; value: T } | { ok: false; error: BookingFailure };

async function schedulingContext(store: DataStore, salon: Salon, from: Date, to: Date) {
  const [staff, busy] = await Promise.all([store.listStaff(salon.id), store.listBusy(salon.id, from, to)]);
  return { salon, staff, busy, now: new Date() };
}

function combinedService(primary: Service, addons: Service[]): { service: Service; extraMinutes: number } {
  return {
    service: { ...primary, cleanupMinutes: Math.max(primary.cleanupMinutes, ...addons.map((a) => a.cleanupMinutes)) },
    extraMinutes: addons.reduce((s, a) => s + a.durationMinutes, 0),
  };
}

export async function availableSlots(
  store: DataStore,
  salon: Salon,
  q: { serviceId: string; addonServiceIds?: string[]; date: string; staffId?: string; channel: Channel },
): Promise<Result<AvailableSlot[]>> {
  const services = await store.listServices(salon.id);
  const primary = services.find((s) => s.id === q.serviceId && s.isActive);
  if (!primary) return { ok: false, error: "SERVICE_NOT_FOUND" };
  const addons = (q.addonServiceIds ?? []).map((id) => services.find((s) => s.id === id && s.isActive)).filter(Boolean) as Service[];
  const { start, end } = localDayBounds(q.date, salon.timezone);
  const ctx = await schedulingContext(store, salon, start, addMinutes(end, 60));
  const { service, extraMinutes } = combinedService(primary, addons);
  return { ok: true, value: getAvailability(ctx, { date: q.date, service, extraMinutes, staffId: q.staffId, channel: q.channel }) };
}

export function manageUrl(salon: Salon, appointment: Appointment): string {
  const ttlEnd = Math.min(
    new Date(appointment.startsAt).getTime() + 24 * 3600_000,
    Date.now() + salon.settings.manageLinkTtlDays * 86_400_000,
  );
  const token = signToken({ typ: "manage", sid: salon.id, sub: appointment.id, exp: Math.floor(ttlEnd / 1000) }, signingSecret());
  return `${env().NEXT_PUBLIC_APP_URL}/book/${salon.slug}/manage/${token}`;
}

export function readManageToken(token: string) {
  return verifyToken(token, signingSecret(), "manage");
}

async function resolveCustomer(store: DataStore, salon: Salon, body: PublicBookingBody): Promise<Result<Customer>> {
  if (body.customerId) {
    const v = body.verifiedToken ? verifyToken(body.verifiedToken, signingSecret(), "verified_phone") : null;
    if (!v || v.sid !== salon.id || v.sub !== body.phone) return { ok: false, error: "VERIFICATION_REQUIRED" };
    const c = await store.getCustomer(salon.id, body.customerId);
    if (!c || c.phoneE164 !== body.phone) return { ok: false, error: "VERIFICATION_REQUIRED" };
    return { ok: true, value: c };
  }
  // Unverified: link to an existing profile only on an exact phone + first (+ last) name match.
  // Nothing about that profile is returned to the caller. Different first name → new household member.
  const same = (await store.findCustomersByPhone(salon.id, body.phone)).find(
    (c) =>
      c.firstName.toLowerCase() === body.firstName.toLowerCase() &&
      (!body.lastName || !c.lastName || c.lastName.toLowerCase() === body.lastName.toLowerCase()),
  );
  if (same) return { ok: true, value: same };
  const created = await store.createCustomer({
    salonId: salon.id,
    firstName: body.firstName,
    lastName: body.lastName,
    phoneE164: body.phone,
    preferredLanguage: body.language,
    smsTransactionalConsent: body.smsConsent,
    consentMethod: "web_checkbox",
  });
  return { ok: true, value: created };
}

/** Public self-service booking (website now; AI phone uses the same path with channel "ai_phone"). */
export async function bookPublic(
  store: DataStore,
  salon: Salon,
  body: PublicBookingBody,
  idempotencyKey: string,
  channel: "website" | "ai_phone" = "website",
): Promise<Result<{ appointment: Appointment; manageUrl: string; created: boolean }>> {
  // A retry of a request that already succeeded returns the original booking — before any availability check.
  const prior = await store.findByIdempotencyKey(salon.id, idempotencyKey);
  if (prior) return { ok: true, value: { appointment: prior, manageUrl: manageUrl(salon, prior), created: false } };

  const services = await store.listServices(salon.id);
  const primary = services.find((s) => s.id === body.serviceId && s.isActive);
  if (!primary) return { ok: false, error: "SERVICE_NOT_FOUND" };
  const addons = body.addonServiceIds.map((id) => services.find((s) => s.id === id && s.isActive)).filter(Boolean) as Service[];
  if (addons.length !== body.addonServiceIds.length) return { ok: false, error: "SERVICE_NOT_FOUND" };

  const start = new Date(body.startsAt);
  const ctx = await schedulingContext(store, salon, addMinutes(start, -24 * 60), addMinutes(start, 24 * 60));
  const { service, extraMinutes } = combinedService(primary, addons);

  // Choose the stylist: requested one, else first in preference order who is free.
  const candidates = body.staffId ? [body.staffId] : ctx.staff.filter((s) => s.isActive).sort((a, b) => a.sortOrder - b.sortOrder).map((s) => s.id);
  const staffId = candidates.find((id) => checkSlot(ctx, { service, extraMinutes, staffId: id, start, channel }).ok);
  if (!staffId) return { ok: false, error: "SLOT_UNAVAILABLE" };

  const customer = await resolveCustomer(store, salon, body);
  if (!customer.ok) return customer;

  const res = await store.createAppointment({
    salonId: salon.id,
    staffId,
    customerId: customer.value.id,
    startsAt: start,
    serviceIds: [primary.id, ...addons.map((a) => a.id)],
    source: body.customerId ? "rebooking" : channel,
    idempotencyKey,
    customerNote: body.note,
    attribution: body.ref === "m" ? "missed_call_text" : undefined,
  });
  if (!res.ok) return { ok: false, error: res.code };

  const link = manageUrl(salon, res.value.appointment);
  if (res.value.created && body.smsConsent) {
    await sendConfirmation(salon, res.value.appointment, primary, body.phone, body.language, link);
  }
  return { ok: true, value: { appointment: res.value.appointment, manageUrl: link, created: res.value.created } };
}

async function sendConfirmation(salon: Salon, appt: Appointment, svc: Service, to: string, language: Lang, link: string) {
  const day = new Intl.DateTimeFormat(language === "vi" ? "vi-VN" : "en-US", { weekday: "short", month: "short", day: "numeric", timeZone: salon.timezone }).format(new Date(appt.startsAt));
  const when = `${day} ${formatLocalTime(appt.startsAt, salon.timezone, language)}`;
  const pending = appt.status === "pending_approval";
  const body =
    language === "vi"
      ? `${salon.name}: ${pending ? "Đã nhận yêu cầu" : "Đã đặt lịch"} ${svc.nameVi} lúc ${when}. Đổi/hủy: ${link}`
      : `${salon.name}: ${pending ? "Request received for" : "You're booked for"} ${svc.nameEn} on ${when}. Manage: ${link} Reply STOP to opt out.`;
  try {
    await (await smsProviderFor(salon, env().SMS_PROVIDER)).send({ to, from: salon.providerNumber, body, category: "transactional", salonId: salon.id });
  } catch (e) {
    // A failed confirmation text must never undo a successful booking.
    console.error("confirmation sms failed", e);
  }
}

// ---------------- returning-customer phone verification ----------------
const CODE_TTL_MIN = 10;
const MAX_ATTEMPTS = 5;

export async function startVerification(store: DataStore, salon: Salon, phone: string, language: Lang) {
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await store.saveVerification({
    salonId: salon.id,
    phoneE164: phone,
    codeHash: hashCode(code, `${salon.id}:${phone}`, signingSecret()),
    expiresAt: addMinutes(new Date(), CODE_TTL_MIN).toISOString(),
  });
  const body =
    language === "vi" ? `${salon.name}: Mã xác minh của anh/chị là ${code}` : `${salon.name}: Your verification code is ${code}`;
  const demo = salon.isDemo || env().SMS_PROVIDER === "console";
  await (await smsProviderFor(salon, env().SMS_PROVIDER)).send({ to: phone, from: salon.providerNumber, body, category: "verification", salonId: salon.id });
  // Response is identical whether or not the phone has a profile (no account enumeration).
  // In demo/test mode only, the code is returned so the demo works without a real phone.
  return { sent: true, demoCode: demo ? code : undefined };
}

export interface HouseholdProfile {
  customerId: string;
  firstName: string;
  usualServiceId?: string;
  usualServiceName?: { en: string; vi: string };
  preferredStaffId?: string;
  lastVisitDate?: string;
}

export async function checkVerification(
  store: DataStore,
  salon: Salon,
  phone: string,
  code: string,
): Promise<Result<{ verifiedToken: string; profiles: HouseholdProfile[] }>> {
  const rec = await store.latestVerification(salon.id, phone);
  if (!rec || rec.verifiedAt || new Date(rec.expiresAt) < new Date() || rec.attempts >= MAX_ATTEMPTS)
    return { ok: false, error: "VERIFICATION_REQUIRED" };
  await store.updateVerification(rec.id, { attempts: rec.attempts + 1 });
  const given = Buffer.from(hashCode(code, `${salon.id}:${phone}`, signingSecret()), "hex");
  const stored = Buffer.from(rec.codeHash, "hex");
  if (given.length !== stored.length || !timingSafeEqual(given, stored)) return { ok: false, error: "VERIFICATION_REQUIRED" };
  await store.updateVerification(rec.id, { verifiedAt: new Date().toISOString() });

  const [customers, services] = await Promise.all([store.findCustomersByPhone(salon.id, phone), store.listServices(salon.id)]);
  const verifiedToken = signToken({ typ: "verified_phone", sid: salon.id, sub: phone, exp: Math.floor(Date.now() / 1000) + 30 * 60 }, signingSecret());
  // Minimal disclosure: first name, usual service, preferred stylist, last visit date. No notes, no history.
  const profiles = customers.map((c): HouseholdProfile => {
    const svc = services.find((s) => s.id === c.usualServiceId);
    return {
      customerId: c.id,
      firstName: c.firstName,
      usualServiceId: svc?.id,
      usualServiceName: svc ? { en: svc.nameEn, vi: svc.nameVi } : undefined,
      preferredStaffId: c.preferredStaffId,
      lastVisitDate: c.lastVisitAt ? localDateOf(c.lastVisitAt, salon.timezone) : undefined,
    };
  });
  return { ok: true, value: { verifiedToken, profiles } };
}

// ---------------- staff-side operations ----------------
export async function changeStatus(
  store: DataStore,
  salonId: string,
  appointmentId: string,
  to: AppointmentStatus,
  opts: { finalPriceCents?: number; actorUserId?: string } = {},
): Promise<Result<Appointment>> {
  const before = await store.getAppointment(salonId, appointmentId);
  if (!before) return { ok: false, error: "NOT_FOUND" };
  const price = to === "completed" ? (opts.finalPriceCents ?? before.finalPriceCents ?? before.estimatedPriceCents) : opts.finalPriceCents;
  const res = await store.updateAppointment(salonId, appointmentId, { status: to, finalPriceCents: price }, opts.actorUserId);
  if (!res.ok) return { ok: false, error: res.code };
  if (to === "completed" && before.status !== "completed" && before.customerId) {
    await store.recordCompletedVisit(salonId, before.customerId, price ?? 0, new Date(before.startsAt));
  }
  return { ok: true, value: res.value };
}

export async function cancelByCustomer(store: DataStore, salon: Salon, appointmentId: string): Promise<Result<Appointment>> {
  const a = await store.getAppointment(salon.id, appointmentId);
  if (!a) return { ok: false, error: "NOT_FOUND" };
  if (new Date(a.startsAt) < new Date()) return { ok: false, error: "INVALID_TRANSITION" };
  const res = await store.updateAppointment(salon.id, appointmentId, { status: "canceled", cancelReason: "customer_link" });
  return res.ok ? { ok: true, value: res.value } : { ok: false, error: res.code };
}

export function describeService(s: Service, language: Lang) {
  return `${language === "vi" ? s.nameVi : s.nameEn} · ${formatPrice(s.priceCents, s.priceType)}`;
}

export function bookingWindow(salon: Salon): { first: string; last: string } {
  const today = localDateOf(new Date(), salon.timezone);
  return { first: today, last: addDays(today, salon.settings.maxAdvanceDays) };
}
