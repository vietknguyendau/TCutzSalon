"use server";

import { revalidatePath } from "next/cache";
import { getStaffContext } from "@/lib/auth";
import { availableSlots, changeStatus } from "@/lib/booking/service";
import { checkSlot } from "@/lib/scheduling/engine";
import { haircutProfileBody, localDate, staffBookingBody, statusChangeBody, uuid } from "@/lib/validation";
import { z } from "zod";
import { toE164US } from "@/lib/phone";
import type { AppointmentStatus } from "@/lib/domain/types";

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

const MESSAGES: Record<string, string> = {
  SLOT_TAKEN: "That time overlaps another appointment. Pick a different time.",
  SLOT_HELD: "Someone is booking that time right now. Try another.",
  STAFF_NOT_QUALIFIED: "That stylist doesn't offer this service.",
  STAFF_UNAVAILABLE: "That stylist is off at that time.",
  INVALID_TRANSITION: "That change isn't allowed for this appointment.",
  NOT_FOUND: "Appointment not found.",
};
const msg = (code: string) => MESSAGES[code] ?? "Something went wrong. Please try again.";

function refresh() {
  revalidatePath("/app", "layout");
}

export async function setStatusAction(appointmentId: string, status: AppointmentStatus): Promise<ActionResult> {
  const ctx = await getStaffContext();
  const p = statusChangeBody.safeParse({ appointmentId, status });
  if (!p.success) return { ok: false, error: "Invalid request" };
  const r = await changeStatus(ctx.store, ctx.salon.id, p.data.appointmentId, p.data.status, { actorUserId: ctx.userId });
  refresh();
  return r.ok ? { ok: true } : { ok: false, error: msg(r.error) };
}

export async function staffSlotsAction(serviceId: string, staffId: string, date: string) {
  const ctx = await getStaffContext();
  const p = z.object({ serviceId: uuid, staffId: uuid, date: localDate }).safeParse({ serviceId, staffId, date });
  if (!p.success) return [];
  const r = await availableSlots(ctx.store, ctx.salon, { ...p.data, channel: "manual" });
  return r.ok ? r.value.map((s) => s.start) : [];
}

export async function searchCustomersAction(q: string) {
  const ctx = await getStaffContext();
  const list = await ctx.store.searchCustomers(ctx.salon.id, q.slice(0, 60));
  return list.slice(0, 8).map((c) => ({
    id: c.id,
    name: [c.firstName, c.lastName].filter(Boolean).join(" "),
    phone: c.phoneE164,
    usualServiceId: c.usualServiceId,
    preferredStaffId: c.preferredStaffId,
  }));
}

export async function staffBookAction(input: unknown): Promise<ActionResult<{ appointmentId: string }>> {
  const ctx = await getStaffContext();
  const p = staffBookingBody.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Please check the form" };
  const d = p.data;
  const { store, salon } = ctx;

  let customerId = d.customerId;
  if (customerId && !(await store.getCustomer(salon.id, customerId))) return { ok: false, error: "Customer not found" };
  if (!customerId && d.firstName) {
    const phone = d.phone || undefined;
    const match = phone
      ? (await store.findCustomersByPhone(salon.id, phone)).find((c) => c.firstName.toLowerCase() === d.firstName!.toLowerCase())
      : undefined;
    customerId =
      match?.id ??
      (
        await store.createCustomer({
          salonId: salon.id,
          firstName: d.firstName,
          lastName: d.lastName,
          phoneE164: phone,
          preferredLanguage: "en",
          smsTransactionalConsent: false, // staff must record consent explicitly — never assumed
          consentMethod: "staff_entry",
        })
      ).id;
  }

  const res = await store.createAppointment({
    salonId: salon.id,
    staffId: d.staffId,
    customerId,
    startsAt: new Date(d.startsAt),
    serviceIds: [d.serviceId, ...d.addonServiceIds],
    source: d.source,
    idempotencyKey: `staff-${d.idempotencyKey}`,
    customerNote: d.note,
    initialStatus: d.source === "walk_in" ? "arrived" : "booked",
    actorUserId: ctx.userId,
  });
  refresh();
  return res.ok ? { ok: true, data: { appointmentId: res.value.appointment.id } } : { ok: false, error: msg(res.code) };
}

export async function rescheduleAction(appointmentId: string, startsAtIso: string, staffId: string): Promise<ActionResult> {
  const ctx = await getStaffContext();
  const p = z.object({ id: uuid, start: z.string().datetime({ offset: true }), staffId: uuid }).safeParse({ id: appointmentId, start: startsAtIso, staffId });
  if (!p.success) return { ok: false, error: "Invalid request" };
  const appt = await ctx.store.getAppointment(ctx.salon.id, p.data.id);
  if (!appt) return { ok: false, error: msg("NOT_FOUND") };
  const start = new Date(p.data.start);
  // Qualification check before hitting the store; the store/DB still enforce overlap atomically.
  const [services, staff] = await Promise.all([ctx.store.listServices(ctx.salon.id), ctx.store.listStaff(ctx.salon.id)]);
  const primary = services.find((s) => s.id === appt.services[0]?.serviceId);
  if (primary) {
    const check = checkSlot(
      { salon: ctx.salon, staff, busy: [], now: new Date() },
      { service: primary, staffId: p.data.staffId, start, channel: "manual" },
    );
    if (!check.ok && check.reason === "STAFF_NOT_QUALIFIED") return { ok: false, error: msg("STAFF_NOT_QUALIFIED") };
  }
  const r = await ctx.store.updateAppointment(ctx.salon.id, appt.id, { startsAt: start, staffId: p.data.staffId }, ctx.userId);
  refresh();
  return r.ok ? { ok: true } : { ok: false, error: msg(r.code) };
}

export async function saveHaircutAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const ctx = await getStaffContext();
  const raw = Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string" && v.trim() !== ""));
  const p = haircutProfileBody.safeParse(raw);
  if (!p.success) return { ok: false, error: "Please check the form" };
  const { customerFeedback, ...profile } = p.data;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: ctx.salon.timezone }).format(new Date());
  await ctx.store.saveHaircutVisit(ctx.salon.id, profile, { cutOn: today, customerFeedback }, ctx.userId);
  revalidatePath(`/app/customers/${profile.customerId}`);
  return { ok: true };
}

export async function recordPhotoConsentAction(customerId: string, granted: boolean): Promise<ActionResult> {
  const ctx = await getStaffContext();
  if (!uuid.safeParse(customerId).success) return { ok: false, error: "Invalid request" };
  await ctx.store.recordConsent(ctx.salon.id, customerId, "photo", granted, "verbal_in_salon", ctx.userId);
  revalidatePath(`/app/customers/${customerId}`);
  return { ok: true };
}

const photoBody = z.object({
  customerId: uuid,
  angle: z.enum(["front", "side", "back"]),
  // Client downsizes to ≤ 1000px JPEG before upload; cap at ~600 KB of base64.
  dataUrl: z.string().max(800_000).regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/),
});

export async function addPhotoAction(input: unknown): Promise<ActionResult> {
  const ctx = await getStaffContext();
  const p = photoBody.safeParse(input);
  if (!p.success) return { ok: false, error: "Photo is too large or not a JPEG." };
  try {
    const r = await ctx.store.addHaircutPhoto(ctx.salon.id, p.data.customerId, p.data.angle, p.data.dataUrl, ctx.userId);
    revalidatePath(`/app/customers/${p.data.customerId}`);
    if (!r.ok) return { ok: false, error: r.code === "INVALID_CUSTOMER" ? "Record the customer's photo permission first." : msg(r.code) };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Upload failed" };
  }
}

// ---------------- Phase 2: missed-call text-back ----------------
const simCallBody = z.object({
  phone: z.string().max(32),
  language: z.enum(["en", "vi"]).optional(),
  outcome: z.enum(["missed", "booked"]),
  when: z.enum(["now", "afternoon", "tonight"]),
});

/** Demo-only: runs the REAL text-back pipeline with the console SMS provider (nothing is sent). */
export async function simulateMissedCallAction(input: unknown) {
  const ctx = await getStaffContext();
  if (!ctx.salon.isDemo) return { ok: false as const, error: "The simulator only runs for demo salons." };
  const p = simCallBody.safeParse(input);
  const phone = p.success ? toE164US(p.data.phone) : null;
  if (!p.success || !phone) return { ok: false as const, error: "Enter a valid US phone number." };
  const { processCallEnded } = await import("@/lib/textback/service");
  const { localDateOf, localToUtc } = await import("@/lib/scheduling/time");
  const tz = ctx.salon.timezone;
  const today = localDateOf(new Date(), tz);
  const now =
    p.data.when === "tonight" ? localToUtc(today, 21 * 60 + 45, tz) : p.data.when === "afternoon" ? localToUtc(today, 14 * 60, tz) : new Date();
  const r = await processCallEnded(
    ctx.store,
    ctx.salon,
    { provider: "simulator", externalCallId: `sim-${crypto.randomUUID()}`, from: phone, outcome: p.data.outcome, language: p.data.language },
    { now },
  );
  revalidatePath("/app", "layout");
  if (r.status === "duplicate") return { ok: false as const, error: "Duplicate" };
  return {
    ok: true as const,
    phone,
    decision: r.decision.action === "skip" ? { action: "skip" as const, reason: r.decision.reason } : { action: r.decision.action, template: r.decision.template },
    text: r.notification ? { body: r.notification.body, status: r.notification.status, scheduledFor: r.notification.scheduledFor } : undefined,
    callback: !!r.callback,
  };
}

export async function simulateReplyAction(phoneRaw: string, body: string) {
  const ctx = await getStaffContext();
  if (!ctx.salon.isDemo) return { ok: false as const, error: "The simulator only runs for demo salons." };
  const phone = toE164US(phoneRaw);
  if (!phone || !body.trim()) return { ok: false as const, error: "Need a phone and a message." };
  const { handleInboundSms } = await import("@/lib/textback/service");
  const r = await handleInboundSms(ctx.store, ctx.salon, phone, body.slice(0, 500));
  revalidatePath("/app", "layout");
  return { ok: true as const, intent: r.intent, reply: r.reply };
}

export async function resolveCallbackAction(id: string, status: "done" | "dismissed"): Promise<ActionResult> {
  const ctx = await getStaffContext();
  if (!uuid.safeParse(id).success || !["done", "dismissed"].includes(status)) return { ok: false, error: "Invalid request" };
  await ctx.store.resolveCallback(ctx.salon.id, id, status);
  revalidatePath("/app", "layout");
  return { ok: true };
}

// ---------------- Salon profile (Settings) ----------------
export type ProfileResult = { ok: true; message: string } | { ok: false; error: string } | null;

export async function saveSalonProfileAction(_prev: ProfileResult, form: FormData): Promise<ProfileResult> {
  const ctx = await getStaffContext();
  if (!["owner", "manager"].includes(ctx.role)) return { ok: false, error: "Only the owner or a manager can change the salon profile." };
  const { salonProfileSchema, encodeProfile, DEMO_BRAND_COOKIE } = await import("@/lib/salon-profile");
  const p = salonProfileSchema.safeParse({
    name: form.get("name"),
    ownerFirstName: form.get("ownerFirstName") ?? undefined,
    ownerTitleVi: form.get("ownerTitleVi") ?? undefined,
    phone: form.get("phone") ?? undefined,
    address: form.get("address") ?? undefined,
  });
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Please check the form." };

  if (ctx.salon.isDemo && ctx.demo) {
    const { cookies } = await import("next/headers");
    (await cookies()).set(DEMO_BRAND_COOKIE, encodeProfile(p.data), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 180,
    });
  } else {
    await ctx.store.updateSalonProfile(ctx.salon.id, p.data);
  }
  revalidatePath("/", "layout");
  return { ok: true, message: `Saved. Everything now shows “${p.data.name}”.` };
}

export async function resetDemoProfileAction(): Promise<ProfileResult> {
  const ctx = await getStaffContext();
  if (!ctx.demo) return { ok: false, error: "Only available in demo mode." };
  const { DEMO_BRAND_COOKIE } = await import("@/lib/salon-profile");
  (await (await import("next/headers")).cookies()).delete(DEMO_BRAND_COOKIE);
  revalidatePath("/", "layout");
  return { ok: true, message: "Back to the default demo salon." };
}
