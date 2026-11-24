import type {
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

  saveVerification(rec: Omit<VerificationRecord, "id" | "attempts">): Promise<VerificationRecord>;
  latestVerification(salonId: string, phoneE164: string): Promise<VerificationRecord | null>;
  updateVerification(id: string, patch: Partial<Pick<VerificationRecord, "attempts" | "verifiedAt">>): Promise<void>;
}
