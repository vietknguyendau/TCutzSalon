import type {
  CallLog,
  CallbackRequest,
  NotificationRecord,
  Appointment,
  AppointmentSource,
  AppointmentStatus,
  Customer,
  HaircutHistoryEntry,
  HaircutProfile,
  Lang,
  Salon,
  Service,
  Staff,
} from "../domain/types";
import type { BusyBlock } from "../scheduling/engine";

export type BookingErrorCode =
  | "SLOT_TAKEN"
  | "SLOT_HELD"
  | "STAFF_UNAVAILABLE"
  | "STAFF_NOT_QUALIFIED"
  | "INVALID_SERVICE"
  | "INVALID_STAFF"
  | "INVALID_CUSTOMER"
  | "INVALID_TRANSITION"
  | "NOT_FOUND";

export interface CreateAppointmentInput {
  salonId: string;
  staffId: string;
  customerId?: string;
  startsAt: Date;
  serviceIds: string[];
  source: AppointmentSource;
  idempotencyKey: string;
  customerNote?: string;
  initialStatus?: AppointmentStatus;
  actorUserId?: string;
  attribution?: string;
}

export type StoreResult<T> = { ok: true; value: T } | { ok: false; code: BookingErrorCode };

export interface AppointmentPatch {
  status?: AppointmentStatus;
  startsAt?: Date;
  staffId?: string;
  finalPriceCents?: number;
  internalNote?: string;
  cancelReason?: string;
}

export interface NewCustomer {
  salonId: string;
  firstName: string;
  lastName?: string;
  phoneE164?: string;
  preferredLanguage: Lang;
  smsTransactionalConsent: boolean;
  smsMarketingConsent?: boolean;
  consentMethod: string;
}

export interface VerificationRecord {
  id: string;
  salonId: string;
  phoneE164: string;
  codeHash: string;
  attempts: number;
  expiresAt: string;
  verifiedAt?: string;
}

/**
 * Persistence boundary. Two implementations:
 *  - DemoStore: in-memory synthetic data (no credentials needed).
 *  - SupabaseStore: Postgres via Supabase; booking goes through book_appointment().
 * Every implementation MUST make createAppointment/updateAppointment atomic with respect to overlaps.
 */
export interface DataStore {
  readonly mode: "demo" | "supabase";
  getSalonBySlug(slug: string): Promise<Salon | null>;
  getSalonById(id: string): Promise<Salon | null>;
  listServices(salonId: string): Promise<Service[]>;
  updateSalonProfile(salonId: string, p: { name: string; ownerFirstName?: string; ownerTitleVi?: string; phone?: string; address?: string }): Promise<void>;
  listStaff(salonId: string): Promise<Staff[]>;
  listBusy(salonId: string, from: Date, to: Date): Promise<BusyBlock[]>;

  listAppointments(salonId: string, from: Date, to: Date): Promise<Appointment[]>;
  getAppointment(salonId: string, id: string): Promise<Appointment | null>;
  listCustomerAppointments(salonId: string, customerId: string): Promise<Appointment[]>;
  findByIdempotencyKey(salonId: string, key: string): Promise<Appointment | null>;
  createAppointment(input: CreateAppointmentInput): Promise<StoreResult<{ appointment: Appointment; created: boolean }>>;
  updateAppointment(salonId: string, id: string, patch: AppointmentPatch, actorUserId?: string): Promise<StoreResult<Appointment>>;

  getCustomer(salonId: string, id: string): Promise<Customer | null>;
  findCustomersByPhone(salonId: string, phoneE164: string): Promise<Customer[]>;
  searchCustomers(salonId: string, query: string): Promise<Customer[]>;
  createCustomer(input: NewCustomer): Promise<Customer>;
  recordCompletedVisit(salonId: string, customerId: string, priceCents: number, at: Date): Promise<void>;

  getHaircutProfile(salonId: string, customerId: string): Promise<HaircutProfile | null>;
  listHaircutHistory(salonId: string, customerId: string): Promise<HaircutHistoryEntry[]>;
  /** Upserts the current profile and appends an immutable history snapshot. */
  saveHaircutVisit(
    salonId: string,
    profile: Omit<HaircutProfile, "updatedAt">,
    visit: { cutOn: string; staffId?: string; appointmentId?: string; customerFeedback?: string },
    actorUserId?: string,
  ): Promise<void>;

  recordConsent(salonId: string, customerId: string, consent: "photo" | "sms_transactional" | "sms_marketing", granted: boolean, method: string, actorUserId?: string): Promise<void>;
  /** Attaches a photo to the most recent haircut history entry (creates today's entry if none). Requires photo consent. */
  addHaircutPhoto(salonId: string, customerId: string, angle: "front" | "side" | "back", jpegDataUrl: string, actorUserId?: string): Promise<StoreResult<{ id: string }>>;

  // ---- communications (Phase 2) ----
  findSalonByProviderNumber(e164: string): Promise<Salon | null>;
  /** Returns true the first time a (provider, externalId) pair is seen — webhook idempotency. */
  recordWebhookEvent(provider: string, externalId: string, payload: unknown, salonId?: string): Promise<boolean>;
  isOptedOut(salonId: string, phoneE164: string): Promise<boolean>;
  setOptOut(salonId: string, phoneE164: string, optedOut: boolean, source: "sms_keyword" | "staff" | "web"): Promise<void>;
  lastNotificationAt(salonId: string, toE164: string, templates: string[]): Promise<Date | null>;
  createNotification(n: Omit<NotificationRecord, "id" | "createdAt">): Promise<NotificationRecord>;
  updateNotification(id: string, patch: Partial<Pick<NotificationRecord, "status" | "provider" | "providerMessageId" | "sentAt" | "error" | "segments">>): Promise<void>;
  markNotificationByProviderId(providerMessageId: string, status: "delivered" | "failed", error?: string): Promise<void>;
  /** Queued notifications due to send, across all salons (cron dispatcher). */
  listDueNotifications(now: Date, limit: number): Promise<NotificationRecord[]>;
  listNotifications(salonId: string, limit: number): Promise<NotificationRecord[]>;
  /** Insert-or-merge by (provider, externalCallId). */
  upsertCall(c: Omit<CallLog, "id" | "createdAt">): Promise<CallLog>;
  getCall(provider: string, externalCallId: string): Promise<CallLog | null>;
  listCalls(salonId: string, since: Date): Promise<CallLog[]>;
  /** One open request per phone: a repeat appends the message to the existing open request. */
  createCallback(c: Omit<CallbackRequest, "id" | "createdAt" | "status">): Promise<CallbackRequest>;
  listCallbacks(salonId: string, status: CallbackRequest["status"]): Promise<CallbackRequest[]>;
  resolveCallback(salonId: string, id: string, status: "done" | "dismissed"): Promise<void>;

  saveVerification(rec: Omit<VerificationRecord, "id" | "attempts">): Promise<VerificationRecord>;
  latestVerification(salonId: string, phoneE164: string): Promise<VerificationRecord | null>;
  updateVerification(id: string, patch: Partial<Pick<VerificationRecord, "attempts" | "verifiedAt">>): Promise<void>;
}
