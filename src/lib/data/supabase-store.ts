import "server-only";
// Supabase implementation. Booking goes through the book_appointment() RPC (advisory lock +
// idempotency + EXCLUDE constraint). Reschedules rely on the EXCLUDE constraint (SQLSTATE 23P01).
// NOTE: written against the schema in supabase/migrations and verified there with SQL tests;
// exercise it against a real Supabase project before go-live (see IMPLEMENTATION_STATUS.md).

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CallLog,
  CallbackRequest,
  NotificationRecord,
  Appointment,
  Customer,
  HaircutHistoryEntry,
  HaircutProfile,
  Salon,
  Service,
  Staff,
  WeeklyHours,
} from "../domain/types";
import { canTransition } from "../domain/status";
import type { BusyBlock } from "../scheduling/engine";
import type { AppointmentPatch, BookingErrorCode, CreateAppointmentInput, DataStore, NewCustomer, StoreResult, VerificationRecord } from "./store";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

const KNOWN_CODES: BookingErrorCode[] = [
  "SLOT_TAKEN", "SLOT_HELD", "STAFF_UNAVAILABLE", "STAFF_NOT_QUALIFIED", "INVALID_SERVICE", "INVALID_STAFF", "INVALID_CUSTOMER",
];

function mapSalon(r: Row, settings: Row | null): Salon {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    timezone: r.timezone,
    phone: r.phone_e164 ?? "",
    address: r.address ?? "",
    websiteUrl: r.website_url ?? undefined,
    isDemo: r.is_demo,
    providerNumber: r.provider_number_e164 ?? undefined,
    brand: { primary: "#1C1B1A", accent: "#C9A96E", background: "#F5F0E8", ...(r.brand ?? {}) },
    settings: {
      slotIntervalMinutes: settings?.slot_interval_minutes ?? 15,
      minBookingNoticeMinutes: settings?.min_booking_notice_minutes ?? 60,
      maxAdvanceDays: settings?.max_advance_days ?? 60,
      holdMinutes: settings?.hold_minutes ?? 5,
      businessHours: (settings?.business_hours ?? {}) as WeeklyHours,
      closedDates: settings?.closed_dates ?? [],
      supportedLanguages: settings?.supported_languages ?? ["en", "vi"],
      defaultLanguage: settings?.default_language ?? "en",
      manageLinkTtlDays: settings?.manage_link_ttl_days ?? 30,
      cancellationPolicyEn: settings?.cancellation_policy ?? undefined,
      quietHours: settings?.quiet_hours ?? { start: "20:00", end: "09:00" },
      missedCallTextBack: {
        enabled: settings?.missed_call_settings?.enabled ?? true,
        dedupeHours: settings?.missed_call_settings?.dedupe_hours ?? 12,
        upcomingWindowDays: settings?.missed_call_settings?.upcoming_window_days ?? 14,
      },
      publicBookingUrl: settings?.public_booking_url ?? undefined,
    },
  };
}

const mapService = (r: Row): Service => ({
  id: r.id, salonId: r.salon_id, nameEn: r.name_en, nameVi: r.name_vi, priceCents: r.price_cents, priceType: r.price_type,
  durationMinutes: r.duration_minutes, processingMinutes: r.processing_minutes, cleanupMinutes: r.cleanup_minutes,
  requiresApproval: r.requires_approval, onlineBookable: r.online_bookable, aiBookable: r.ai_bookable, isActive: r.is_active,
  sortOrder: r.sort_order,
});

const mapAppointment = (r: Row): Appointment => ({
  id: r.id, salonId: r.salon_id, customerId: r.customer_id ?? undefined, staffId: r.staff_id,
  startsAt: new Date(r.starts_at).toISOString(), endsAt: new Date(r.ends_at).toISOString(),
  blockedUntil: new Date(r.blocked_until).toISOString(), status: r.status, source: r.source,
  idempotencyKey: r.idempotency_key ?? undefined, estimatedPriceCents: r.estimated_price_cents,
  finalPriceCents: r.final_price_cents ?? undefined,
  services: (r.appointment_services ?? []).map((l: Row) => ({
    serviceId: l.service_id, name: l.name_snapshot, priceCents: l.price_cents_snapshot, priceType: l.price_type_snapshot,
    durationMinutes: l.duration_minutes_snapshot,
  })),
  customerNote: r.customer_note ?? undefined, internalNote: r.internal_note ?? undefined, isDemo: r.is_demo,
  createdAt: r.created_at, canceledAt: r.canceled_at ?? undefined, attribution: r.attribution ?? undefined,
});

const mapNotification = (r: Row): NotificationRecord => ({
  id: r.id, salonId: r.salon_id, customerId: r.customer_id ?? undefined, appointmentId: r.appointment_id ?? undefined,
  channel: "sms", category: r.category, template: r.template, toAddress: r.to_address, body: r.body, status: r.status,
  provider: r.provider ?? undefined, providerMessageId: r.provider_message_id ?? undefined, scheduledFor: r.scheduled_for,
  sentAt: r.sent_at ?? undefined, error: r.error ?? undefined, segments: r.segments ?? undefined, createdAt: r.created_at,
});
const mapCall = (r: Row): CallLog => ({
  id: r.id, salonId: r.salon_id, provider: r.provider, externalCallId: r.external_call_id, fromE164: r.from_e164 ?? undefined,
  language: r.language ?? undefined, startedAt: r.started_at ?? undefined, endedAt: r.ended_at ?? undefined,
  durationSeconds: r.duration_seconds ?? undefined, outcome: r.outcome ?? undefined, appointmentId: r.appointment_id ?? undefined,
  createdAt: r.created_at,
});
const mapCallback = (r: Row): CallbackRequest => ({
  id: r.id, salonId: r.salon_id, customerId: r.customer_id ?? undefined, phoneE164: r.phone_e164, name: r.name ?? undefined,
  reason: r.reason, message: r.message ?? undefined, language: r.language ?? undefined, status: r.status, createdAt: r.created_at,
  resolvedAt: r.resolved_at ?? undefined,
});

function mapCustomer(r: Row): Customer {
  const consents: Row[] = r.customer_consents ?? [];
  const latest = (type: string) =>
    consents.filter((c) => c.consent === type).sort((a, b) => b.recorded_at.localeCompare(a.recorded_at))[0]?.granted ?? false;
  return {
    id: r.id, salonId: r.salon_id, firstName: r.first_name, lastName: r.last_name ?? undefined, phoneE164: r.phone_e164 ?? undefined,
    email: r.email ?? undefined, preferredLanguage: r.preferred_language, preferredStaffId: r.preferred_staff_id ?? undefined,
    usualServiceId: r.customer_preferences?.usual_service_id ?? undefined, firstVisitAt: r.first_visit_at ?? undefined,
    lastVisitAt: r.last_visit_at ?? undefined, completedVisits: r.completed_visits, lifetimeSpendCents: r.lifetime_spend_cents,
    noShowCount: 0, cancelCount: 0, smsTransactionalConsent: latest("sms_transactional"), smsMarketingConsent: latest("sms_marketing"),
    photoConsent: latest("photo"), notes: r.notes ?? undefined, isSynthetic: r.is_synthetic, createdAt: r.created_at,
  };
}

const CUSTOMER_SELECT = "*, customer_preferences(usual_service_id), customer_consents(consent, granted, recorded_at)";
const APPT_SELECT = "*, appointment_services(*)";

export class SupabaseStore implements DataStore {
  readonly mode = "supabase" as const;
  /**
   * @param db    client used for reads/writes — a user-scoped client (RLS) for dashboards, or the
   *              service client for validated public endpoints.
   * @param admin service-role client; required for book_appointment() and verification records.
   */
  constructor(private db: SupabaseClient, private admin: SupabaseClient) {}

  /** Unwraps a Supabase response or throws. Returns untyped rows; mappers below give them shape. */
  private async must(p: PromiseLike<{ data: unknown; error: any }>): Promise<any> {
    const { data, error } = await p;
    if (error) throw new Error(`Supabase: ${error.message}`);
    return data;
  }


  async getSalonBySlug(slug: string) {
    const r = await this.must(this.db.from("salons").select("*, salon_settings(*)").eq("slug", slug).maybeSingle());
    return r ? mapSalon(r as Row, (r as Row).salon_settings) : null;
  }
  async getSalonById(id: string) {
    const r = await this.must(this.db.from("salons").select("*, salon_settings(*)").eq("id", id).maybeSingle());
    return r ? mapSalon(r as Row, (r as Row).salon_settings) : null;
  }
  async listServices(salonId: string) {
    const rows = await this.must(this.db.from("services").select("*").eq("salon_id", salonId).order("sort_order"));
    return (rows as Row[]).map(mapService);
  }
  async listStaff(salonId: string) {
    const rows = (await this.must(
      this.db.from("staff").select("*, staff_working_hours(*), staff_services(*)").eq("salon_id", salonId).order("sort_order"),
    )) as Row[];
    return rows.map((r): Staff => {
      const hours: WeeklyHours = {};
      for (const h of r.staff_working_hours ?? []) {
        const wd = h.weekday as 0 | 1 | 2 | 3 | 4 | 5 | 6;
        (hours[wd] ??= []).push({ open: String(h.start_time).slice(0, 5), close: String(h.end_time).slice(0, 5) });
      }
      return {
        id: r.id, salonId: r.salon_id, displayName: r.display_name, color: r.color, isActive: r.is_active,
        isBookableOnline: r.is_bookable_online, sortOrder: r.sort_order, workingHours: hours,
        services: (r.staff_services ?? []).map((l: Row) => ({ serviceId: l.service_id, durationOverrideMinutes: l.duration_minutes_override ?? undefined })),
      };
    });
  }
  async listBusy(salonId: string, from: Date, to: Date): Promise<BusyBlock[]> {
    const [appts, off, holds] = await Promise.all([
      this.must(this.db.from("appointments").select("staff_id, starts_at, blocked_until").eq("salon_id", salonId)
        .not("status", "in", "(canceled,no_show)").lt("starts_at", to.toISOString()).gt("blocked_until", from.toISOString())),
      this.must(this.db.from("staff_time_off").select("staff_id, starts_at, ends_at").eq("salon_id", salonId)
        .lt("starts_at", to.toISOString()).gt("ends_at", from.toISOString())),
      this.must(this.admin.from("appointment_holds").select("staff_id, starts_at, blocked_until").eq("salon_id", salonId)
        .gt("expires_at", new Date().toISOString())),
    ]);
    return [
      ...(appts as Row[]).map((r) => ({ staffId: r.staff_id, start: new Date(r.starts_at), end: new Date(r.blocked_until), kind: "appointment" as const })),
      ...(off as Row[]).map((r) => ({ staffId: r.staff_id, start: new Date(r.starts_at), end: new Date(r.ends_at), kind: "time_off" as const })),
      ...(holds as Row[]).map((r) => ({ staffId: r.staff_id, start: new Date(r.starts_at), end: new Date(r.blocked_until), kind: "hold" as const })),
    ];
  }
  async listAppointments(salonId: string, from: Date, to: Date) {
    const rows = await this.must(this.db.from("appointments").select(APPT_SELECT).eq("salon_id", salonId)
      .lt("starts_at", to.toISOString()).gt("ends_at", from.toISOString()).order("starts_at"));
    return (rows as Row[]).map(mapAppointment);
  }
  async getAppointment(salonId: string, id: string) {
    const r = await this.must(this.db.from("appointments").select(APPT_SELECT).eq("salon_id", salonId).eq("id", id).maybeSingle());
    return r ? mapAppointment(r as Row) : null;
  }
  async listCustomerAppointments(salonId: string, customerId: string) {
    const rows = await this.must(this.db.from("appointments").select(APPT_SELECT).eq("salon_id", salonId)
      .eq("customer_id", customerId).order("starts_at", { ascending: false }).limit(100));
    return (rows as Row[]).map(mapAppointment);
  }

  async findByIdempotencyKey(salonId: string, key: string) {
    const r = await this.must(this.admin.from("appointments").select(APPT_SELECT).eq("salon_id", salonId).eq("idempotency_key", key).maybeSingle());
    return r ? mapAppointment(r as Row) : null;
  }

  async createAppointment(input: CreateAppointmentInput): Promise<StoreResult<{ appointment: Appointment; created: boolean }>> {
    const { data, error } = await this.admin.rpc("book_appointment", {
      p_salon_id: input.salonId, p_staff_id: input.staffId, p_customer_id: input.customerId ?? null,
      p_starts_at: input.startsAt.toISOString(), p_service_ids: input.serviceIds, p_source: input.source,
      p_idempotency_key: input.idempotencyKey, p_customer_note: input.customerNote ?? null, p_hold_token: null,
      p_actor: input.actorUserId ?? null, p_initial_status: input.initialStatus ?? null,
    });
    if (error) {
      const code = KNOWN_CODES.find((c) => error.message?.includes(c));
      if (code) return { ok: false, code };
      throw new Error(`book_appointment failed: ${error.message}`);
    }
    const row = (Array.isArray(data) ? data[0] : data) as Row;
    if (row.was_created && input.attribution) {
      await this.must(this.admin.from("appointments").update({ attribution: input.attribution }).eq("id", row.appointment_id));
    }
    const appt = await this.must(this.admin.from("appointments").select(APPT_SELECT).eq("id", row.appointment_id).single());
    return { ok: true, value: { appointment: mapAppointment(appt as unknown as Row), created: row.was_created } };
  }

  async updateAppointment(salonId: string, id: string, patch: AppointmentPatch): Promise<StoreResult<Appointment>> {
    const current = await this.getAppointment(salonId, id);
    if (!current) return { ok: false, code: "NOT_FOUND" };
    if (patch.status && patch.status !== current.status && !canTransition(current.status, patch.status))
      return { ok: false, code: "INVALID_TRANSITION" };
    const upd: Row = {};
    if (patch.status) upd.status = patch.status;
    if (patch.status === "canceled") { upd.canceled_at = new Date().toISOString(); upd.cancel_reason = patch.cancelReason ?? null; }
    if (patch.finalPriceCents !== undefined) upd.final_price_cents = patch.finalPriceCents;
    if (patch.internalNote !== undefined) upd.internal_note = patch.internalNote;
    if (patch.staffId) upd.staff_id = patch.staffId;
    if (patch.startsAt) {
      const shift = patch.startsAt.getTime() - new Date(current.startsAt).getTime();
      upd.starts_at = patch.startsAt.toISOString();
      upd.ends_at = new Date(new Date(current.endsAt).getTime() + shift).toISOString();
      upd.blocked_until = new Date(new Date(current.blockedUntil).getTime() + shift).toISOString();
    }
    // Optimistic concurrency: only update if status hasn't changed underneath us.
    const { data, error } = await this.db.from("appointments").update(upd).eq("salon_id", salonId).eq("id", id)
      .eq("status", current.status).select(APPT_SELECT).maybeSingle();
    if (error) {
      if (error.code === "23P01") return { ok: false, code: "SLOT_TAKEN" };
      throw new Error(`update appointment: ${error.message}`);
    }
    if (!data) return { ok: false, code: "INVALID_TRANSITION" };
    return { ok: true, value: mapAppointment(data as Row) };
  }

  async getCustomer(salonId: string, id: string) {
    const r = await this.must(this.db.from("customers").select(CUSTOMER_SELECT).eq("salon_id", salonId).eq("id", id).maybeSingle());
    return r ? mapCustomer(r as Row) : null;
  }
  async findCustomersByPhone(salonId: string, phone: string) {
    const rows = await this.must(this.db.from("customers").select(CUSTOMER_SELECT).eq("salon_id", salonId).eq("phone_e164", phone).is("anonymized_at", null));
    return (rows as Row[]).map(mapCustomer);
  }
  async searchCustomers(salonId: string, query: string) {
    let req = this.db.from("customers").select(CUSTOMER_SELECT).eq("salon_id", salonId).is("anonymized_at", null);
    const q = query.trim().replace(/[%,()]/g, "");
    const digits = q.replace(/\D/g, "");
    if (q) {
      req = digits.length >= 3
        ? req.ilike("phone_e164", `%${digits}%`)
        : req.or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%`);
    }
    const rows = await this.must(req.order("last_visit_at", { ascending: false, nullsFirst: false }).limit(50));
    return (rows as Row[]).map(mapCustomer);
  }
  async createCustomer(input: NewCustomer) {
    const r = (await this.must(this.admin.from("customers").insert({
      salon_id: input.salonId, first_name: input.firstName, last_name: input.lastName ?? null,
      phone_e164: input.phoneE164 ?? null, preferred_language: input.preferredLanguage,
    }).select("*").single())) as Row;
    const consents = [{ salon_id: input.salonId, customer_id: r.id, consent: "sms_transactional", granted: input.smsTransactionalConsent, method: input.consentMethod }];
    if (input.smsMarketingConsent !== undefined)
      consents.push({ salon_id: input.salonId, customer_id: r.id, consent: "sms_marketing", granted: input.smsMarketingConsent, method: input.consentMethod });
    await this.must(this.admin.from("customer_consents").insert(consents));
    return (await this.getCustomerAdmin(input.salonId, r.id))!;
  }
  private async getCustomerAdmin(salonId: string, id: string) {
    const r = await this.must(this.admin.from("customers").select(CUSTOMER_SELECT).eq("salon_id", salonId).eq("id", id).maybeSingle());
    return r ? mapCustomer(r as Row) : null;
  }
  async recordCompletedVisit(salonId: string, customerId: string, priceCents: number, at: Date) {
    const c = await this.getCustomerAdmin(salonId, customerId);
    if (!c) return;
    await this.must(this.admin.from("customers").update({
      completed_visits: c.completedVisits + 1, lifetime_spend_cents: c.lifetimeSpendCents + priceCents,
      last_visit_at: at.toISOString(), first_visit_at: c.firstVisitAt ?? at.toISOString(),
    }).eq("salon_id", salonId).eq("id", customerId));
  }

  async getHaircutProfile(salonId: string, customerId: string) {
    const r = (await this.must(this.db.from("haircut_profiles").select("*").eq("salon_id", salonId).eq("customer_id", customerId).maybeSingle())) as Row | null;
    if (!r) return null;
    return {
      customerId: r.customer_id, style: r.style ?? undefined, clipperGuard: r.clipper_guard ?? undefined, fadeType: r.fade_type ?? undefined,
      sideLength: r.side_length ?? undefined, topLength: r.top_length ?? undefined, backLength: r.back_length ?? undefined,
      scissorNotes: r.scissor_notes ?? undefined, hairline: r.hairline ?? undefined, beard: r.beard ?? undefined,
      colorFormula: r.color_formula ?? undefined, products: r.products ?? undefined, stylistNotes: r.stylist_notes ?? undefined,
      updatedAt: r.updated_at,
    } satisfies HaircutProfile;
  }
  async listHaircutHistory(salonId: string, customerId: string): Promise<HaircutHistoryEntry[]> {
    const rows = (await this.must(this.db.from("haircut_history").select("*, haircut_photos(id, angle, storage_path)")
      .eq("salon_id", salonId).eq("customer_id", customerId).order("cut_on", { ascending: false }))) as Row[];
    return rows.map((r) => ({
      id: r.id, customerId: r.customer_id, appointmentId: r.appointment_id ?? undefined, staffId: r.staff_id ?? undefined,
      cutOn: r.cut_on, snapshot: r.snapshot, customerFeedback: r.customer_feedback ?? undefined, createdAt: r.created_at,
      photos: [], // Phase 1: photo signed-URL generation is pending (see IMPLEMENTATION_STATUS.md)
    }));
  }
  async saveHaircutVisit(
    salonId: string,
    profile: Omit<HaircutProfile, "updatedAt">,
    visit: { cutOn: string; staffId?: string; appointmentId?: string; customerFeedback?: string },
    actorUserId?: string,
  ) {
    const { customerId, ...snap } = profile;
    await this.must(this.db.from("haircut_profiles").upsert({
      customer_id: customerId, salon_id: salonId, style: snap.style ?? null, clipper_guard: snap.clipperGuard ?? null,
      fade_type: snap.fadeType ?? null, side_length: snap.sideLength ?? null, top_length: snap.topLength ?? null,
      back_length: snap.backLength ?? null, scissor_notes: snap.scissorNotes ?? null, hairline: snap.hairline ?? null,
      beard: snap.beard ?? null, color_formula: snap.colorFormula ?? null, products: snap.products ?? null,
      stylist_notes: snap.stylistNotes ?? null, updated_by: actorUserId ?? null, updated_at: new Date().toISOString(),
    }));
    await this.must(this.db.from("haircut_history").insert({
      salon_id: salonId, customer_id: customerId, appointment_id: visit.appointmentId ?? null, staff_id: visit.staffId ?? null,
      cut_on: visit.cutOn, snapshot: snap, customer_feedback: visit.customerFeedback ?? null, created_by: actorUserId ?? null,
    }));
  }

  async recordConsent(salonId: string, customerId: string, consent: "photo" | "sms_transactional" | "sms_marketing", granted: boolean, method: string, actorUserId?: string) {
    await this.must(this.db.from("customer_consents").insert({
      salon_id: salonId, customer_id: customerId, consent, granted, method, recorded_by: actorUserId ?? null,
    }));
  }
  async addHaircutPhoto(): Promise<StoreResult<{ id: string }>> {
    // Phase 1 gap: Supabase Storage upload (signed upload URL → haircut-photos/{salon}/{customer}/{uuid}.jpg,
    // then insert haircut_photos with consent_id) is not wired yet. Storage policies already exist (0004).
    throw new Error("Photo upload to Supabase Storage is not implemented yet — see IMPLEMENTATION_STATUS.md");
  }

  async findSalonByProviderNumber(e164: string) {
    const r = await this.must(this.admin.from("salons").select("*, salon_settings(*)").eq("provider_number_e164", e164).maybeSingle());
    return r ? mapSalon(r as Row, (r as Row).salon_settings) : null;
  }
  async recordWebhookEvent(provider: string, externalId: string, payload: unknown, salonId?: string) {
    const { error } = await this.admin.from("webhook_events").insert({ provider, external_id: externalId, payload, salon_id: salonId ?? null });
    if (!error) return true;
    if (error.code === "23505") return false; // unique (provider, external_id) → duplicate delivery
    throw new Error(`webhook_events: ${error.message}`);
  }
  async isOptedOut(salonId: string, phone: string) {
    const r = await this.must(this.admin.from("sms_opt_outs").select("opted_out").eq("salon_id", salonId).eq("phone_e164", phone).maybeSingle());
    return (r as Row | null)?.opted_out === true;
  }
  async setOptOut(salonId: string, phone: string, optedOut: boolean, source: "sms_keyword" | "staff" | "web") {
    await this.must(this.admin.from("sms_opt_outs").upsert({ salon_id: salonId, phone_e164: phone, opted_out: optedOut, source, updated_at: new Date().toISOString() }));
  }
  async lastNotificationAt(salonId: string, to: string, templates: string[]) {
    // scheduled_for = when the text went (or will go) out — a text held for quiet hours still counts.
    const r = (await this.must(this.admin.from("notifications").select("scheduled_for").eq("salon_id", salonId).eq("to_address", to)
      .in("template", templates).not("status", "in", "(failed,suppressed)").order("scheduled_for", { ascending: false }).limit(1).maybeSingle())) as Row | null;
    return r ? new Date(r.scheduled_for) : null;
  }
  async createNotification(n: Omit<NotificationRecord, "id" | "createdAt">) {
    const r = await this.must(this.admin.from("notifications").insert({
      salon_id: n.salonId, customer_id: n.customerId ?? null, appointment_id: n.appointmentId ?? null, channel: n.channel,
      category: n.category, template: n.template, to_address: n.toAddress, body: n.body, status: n.status, provider: n.provider ?? null,
      provider_message_id: n.providerMessageId ?? null, scheduled_for: n.scheduledFor, sent_at: n.sentAt ?? null, error: n.error ?? null,
      segments: n.segments ?? null,
    }).select("*").single());
    return mapNotification(r as Row);
  }
  async updateNotification(id: string, p: Partial<NotificationRecord>) {
    await this.must(this.admin.from("notifications").update({
      ...(p.status ? { status: p.status } : {}), ...(p.provider ? { provider: p.provider } : {}), ...(p.providerMessageId ? { provider_message_id: p.providerMessageId } : {}),
      ...(p.sentAt ? { sent_at: p.sentAt } : {}), ...(p.error !== undefined ? { error: p.error } : {}),
      ...(p.segments !== undefined ? { segments: p.segments } : {}),
    }).eq("id", id));
  }
  async markNotificationByProviderId(providerMessageId: string, status: "delivered" | "failed", error?: string) {
    await this.must(this.admin.from("notifications").update({ status, error: error ?? null }).eq("provider_message_id", providerMessageId));
  }
  async listDueNotifications(now: Date, limit: number) {
    const rows = await this.must(this.admin.from("notifications").select("*").eq("status", "queued").lte("scheduled_for", now.toISOString())
      .order("scheduled_for").limit(limit));
    return (rows as Row[]).map(mapNotification);
  }
  async listNotifications(salonId: string, limit: number) {
    const rows = await this.must(this.db.from("notifications").select("*").eq("salon_id", salonId).order("created_at", { ascending: false }).limit(limit));
    return (rows as Row[]).map(mapNotification);
  }
  async upsertCall(c: Omit<CallLog, "id" | "createdAt">) {
    const row: Row = { salon_id: c.salonId, provider: c.provider, external_call_id: c.externalCallId };
    if (c.fromE164) row.from_e164 = c.fromE164;
    if (c.language) row.language = c.language;
    if (c.startedAt) row.started_at = c.startedAt;
    if (c.endedAt) row.ended_at = c.endedAt;
    if (c.durationSeconds !== undefined) row.duration_seconds = c.durationSeconds;
    if (c.outcome) row.outcome = c.outcome;
    if (c.appointmentId) row.appointment_id = c.appointmentId;
    const r = await this.must(this.admin.from("ai_call_logs").upsert(row, { onConflict: "provider,external_call_id" }).select("*").single());
    return mapCall(r as Row);
  }
  async getCall(provider: string, externalCallId: string) {
    const r = await this.must(this.admin.from("ai_call_logs").select("*").eq("provider", provider).eq("external_call_id", externalCallId).maybeSingle());
    return r ? mapCall(r as Row) : null;
  }
  async listCalls(salonId: string, since: Date) {
    const rows = await this.must(this.db.from("ai_call_logs").select("*").eq("salon_id", salonId).gte("created_at", since.toISOString())
      .order("created_at", { ascending: false }));
    return (rows as Row[]).map(mapCall);
  }
  async createCallback(c: Omit<CallbackRequest, "id" | "createdAt" | "status">) {
    const open = (await this.must(this.admin.from("callback_requests").select("*").eq("salon_id", c.salonId).eq("phone_e164", c.phoneE164)
      .eq("status", "open").limit(1).maybeSingle())) as Row | null;
    if (open) {
      const message = c.message ? (open.message ? `${open.message}\n${c.message}` : c.message).slice(0, 1000) : open.message;
      const r = await this.must(this.admin.from("callback_requests").update({ message, ...(c.reason === "customer_asked" ? { reason: c.reason } : {}) })
        .eq("id", open.id).select("*").single());
      return mapCallback(r as Row);
    }
    const r = await this.must(this.admin.from("callback_requests").insert({
      salon_id: c.salonId, customer_id: c.customerId ?? null, phone_e164: c.phoneE164, name: c.name ?? null, reason: c.reason,
      message: c.message?.slice(0, 1000) ?? null, language: c.language ?? null,
    }).select("*").single());
    return mapCallback(r as Row);
  }
  async listCallbacks(salonId: string, status: CallbackRequest["status"]) {
    const rows = await this.must(this.db.from("callback_requests").select("*").eq("salon_id", salonId).eq("status", status)
      .order("created_at", { ascending: false }).limit(50));
    return (rows as Row[]).map(mapCallback);
  }
  async resolveCallback(salonId: string, id: string, status: "done" | "dismissed") {
    await this.must(this.db.from("callback_requests").update({ status, resolved_at: new Date().toISOString() }).eq("salon_id", salonId).eq("id", id));
  }

  async saveVerification(rec: Omit<VerificationRecord, "id" | "attempts">) {
    const r = (await this.must(this.admin.from("phone_verifications").insert({
      salon_id: rec.salonId, phone_e164: rec.phoneE164, code_hash: rec.codeHash, expires_at: rec.expiresAt,
    }).select("*").single())) as Row;
    return { id: r.id, salonId: r.salon_id, phoneE164: r.phone_e164, codeHash: r.code_hash, attempts: r.attempts, expiresAt: r.expires_at };
  }
  async latestVerification(salonId: string, phone: string) {
    const r = (await this.must(this.admin.from("phone_verifications").select("*").eq("salon_id", salonId).eq("phone_e164", phone)
      .order("created_at", { ascending: false }).limit(1).maybeSingle())) as Row | null;
    return r ? { id: r.id, salonId: r.salon_id, phoneE164: r.phone_e164, codeHash: r.code_hash, attempts: r.attempts, expiresAt: r.expires_at, verifiedAt: r.verified_at ?? undefined } : null;
  }
  async updateVerification(id: string, patch: Partial<Pick<VerificationRecord, "attempts" | "verifiedAt">>) {
    await this.must(this.admin.from("phone_verifications").update({
      ...(patch.attempts !== undefined ? { attempts: patch.attempts } : {}),
      ...(patch.verifiedAt ? { verified_at: patch.verifiedAt } : {}),
    }).eq("id", id));
  }
}
