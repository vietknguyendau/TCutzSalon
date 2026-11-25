// Domain types shared by the scheduling engine, data stores and UI.
// Timestamps are ISO-8601 UTC strings. Wall-clock times ("HH:mm") are in the salon's timezone.

export type Lang = "en" | "vi";

export const APPOINTMENT_STATUSES = [
  "pending_approval",
  "booked",
  "confirmed",
  "arrived",
  "in_progress",
  "completed",
  "canceled",
  "no_show",
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const APPOINTMENT_SOURCES = ["ai_phone", "website", "manual", "walk_in", "rebooking"] as const;
export type AppointmentSource = (typeof APPOINTMENT_SOURCES)[number];

export type PriceType = "fixed" | "starting_at";

export interface TimeRange {
  open: string; // "HH:mm"
  close: string; // "HH:mm"
}
/** 0 = Sunday … 6 = Saturday */
export type WeeklyHours = Partial<Record<0 | 1 | 2 | 3 | 4 | 5 | 6, TimeRange[]>>;

export interface SalonSettings {
  slotIntervalMinutes: number;
  minBookingNoticeMinutes: number;
  maxAdvanceDays: number;
  holdMinutes: number;
  businessHours: WeeklyHours;
  closedDates: string[]; // "YYYY-MM-DD" local
  supportedLanguages: Lang[];
  defaultLanguage: Lang;
  manageLinkTtlDays: number;
  cancellationPolicyEn?: string;
  cancellationPolicyVi?: string;
  /** Local "HH:mm" window when no automated texts go out (wraps midnight). */
  quietHours: { start: string; end: string };
  missedCallTextBack: { enabled: boolean; dedupeHours: number; upcomingWindowDays: number };
  /** Short public booking URL used in texts (e.g. https://book.yoursalon.com). Falls back to app URL + /book/slug. */
  publicBookingUrl?: string;
}

export interface Salon {
  id: string;
  slug: string;
  name: string;
  timezone: string;
  phone: string;
  address: string;
  websiteUrl?: string;
  isDemo: boolean;
  brand: { primary: string; accent: string; background: string };
  ownerFirstName?: string;
  /** Vietnamese honorific used before the owner's name in texts, e.g. "chị" or "anh". */
  ownerTitleVi?: string;
  /** Twilio (or other provider) number calls are forwarded to and texts are sent from. */
  providerNumber?: string;
  settings: SalonSettings;
}

export interface Service {
  id: string;
  salonId: string;
  nameEn: string;
  nameVi: string;
  priceCents: number;
  priceType: PriceType;
  durationMinutes: number;
  processingMinutes: number;
  cleanupMinutes: number;
  requiresApproval: boolean;
  onlineBookable: boolean;
  aiBookable: boolean;
  isActive: boolean;
  sortOrder: number;
}

export interface StaffService {
  serviceId: string;
  durationOverrideMinutes?: number;
}

export interface Staff {
  id: string;
  salonId: string;
  displayName: string;
  color: string;
  isActive: boolean;
  isBookableOnline: boolean;
  sortOrder: number;
  workingHours: WeeklyHours;
  services: StaffService[];
}

export interface TimeOff {
  id: string;
  salonId: string;
  staffId: string;
  startsAt: string;
  endsAt: string;
  kind: "break" | "lunch" | "personal" | "vacation" | "holiday";
  note?: string;
}

export interface Customer {
  id: string;
  salonId: string;
  firstName: string;
  lastName?: string;
  phoneE164?: string;
  email?: string;
  preferredLanguage: Lang;
  preferredStaffId?: string;
  usualServiceId?: string;
  firstVisitAt?: string;
  lastVisitAt?: string;
  completedVisits: number;
  lifetimeSpendCents: number;
  noShowCount: number;
  cancelCount: number;
  smsTransactionalConsent: boolean;
  smsMarketingConsent: boolean;
  photoConsent: boolean;
  notes?: string;
  isSynthetic: boolean;
  createdAt: string;
}

export interface HaircutProfile {
  customerId: string;
  style?: string;
  clipperGuard?: string;
  fadeType?: string;
  sideLength?: string;
  topLength?: string;
  backLength?: string;
  scissorNotes?: string;
  hairline?: string;
  beard?: string;
  colorFormula?: string;
  products?: string;
  stylistNotes?: string;
  updatedAt: string;
}

export interface HaircutHistoryEntry {
  id: string;
  customerId: string;
  appointmentId?: string;
  staffId?: string;
  cutOn: string; // YYYY-MM-DD
  snapshot: Omit<HaircutProfile, "customerId" | "updatedAt">;
  customerFeedback?: string;
  photos: { id: string; angle: "front" | "side" | "back" | "other"; url: string }[];
  createdAt: string;
}

export interface AppointmentServiceLine {
  serviceId: string;
  name: string;
  priceCents: number;
  priceType: PriceType;
  durationMinutes: number;
}

export interface Appointment {
  id: string;
  salonId: string;
  customerId?: string;
  staffId: string;
  startsAt: string;
  endsAt: string;
  blockedUntil: string;
  status: AppointmentStatus;
  source: AppointmentSource;
  idempotencyKey?: string;
  estimatedPriceCents: number;
  finalPriceCents?: number;
  services: AppointmentServiceLine[];
  customerNote?: string;
  internalNote?: string;
  isDemo: boolean;
  createdAt: string;
  canceledAt?: string;
  /** Marketing attribution, e.g. "missed_call_text". */
  attribution?: string;
}

export type CallOutcome = "missed" | "voicemail" | "abandoned" | "info" | "booked" | "rescheduled" | "canceled" | "transferred" | "callback" | "failed";

export interface CallLog {
  id: string;
  salonId: string;
  provider: string;
  externalCallId: string;
  fromE164?: string;
  language?: Lang;
  startedAt?: string;
  endedAt?: string;
  durationSeconds?: number;
  outcome?: CallOutcome;
  appointmentId?: string;
  createdAt: string;
}

export interface CallbackRequest {
  id: string;
  salonId: string;
  customerId?: string;
  phoneE164: string;
  name?: string;
  reason: "landline_missed_call" | "customer_asked" | "sms_reply" | "ai_escalation";
  message?: string;
  language?: Lang;
  status: "open" | "done" | "dismissed";
  createdAt: string;
  resolvedAt?: string;
}

export type NotificationStatus = "queued" | "sent" | "delivered" | "failed" | "suppressed" | "test_mode";
export interface NotificationRecord {
  id: string;
  salonId: string;
  customerId?: string;
  appointmentId?: string;
  channel: "sms";
  category: "transactional" | "marketing" | "verification";
  template: string;
  toAddress: string;
  body: string;
  status: NotificationStatus;
  provider?: string;
  providerMessageId?: string;
  scheduledFor: string;
  sentAt?: string;
  error?: string;
  segments?: number;
  createdAt: string;
}

/** Statuses that occupy the stylist's time. Mirrors the DB exclusion constraint predicate. */
export const ACTIVE_STATUSES: AppointmentStatus[] = [
  "pending_approval",
  "booked",
  "confirmed",
  "arrived",
  "in_progress",
  "completed",
];

export function isActiveStatus(s: AppointmentStatus): boolean {
  return ACTIVE_STATUSES.includes(s);
}
