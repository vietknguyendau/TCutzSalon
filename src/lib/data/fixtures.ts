// Tcutz pilot configuration + SYNTHETIC demo data. No real customer information lives here.
// Used by the in-memory demo store and by scripts/generate-seed.ts (→ supabase/seed.sql).
// Keep this file free of path-alias imports so Node can run it directly.

import type {
  AppointmentSource,
  AppointmentStatus,
  Customer,
  HaircutHistoryEntry,
  HaircutProfile,
  Salon,
  Service,
  Staff,
  WeeklyHours,
} from "../domain/types";

/** Deterministic UUIDs so seed data and demo data match. */
export const fid = (group: number, n: number) =>
  `00000000-0000-4000-${(8000 + group).toString()}-${String(n).padStart(12, "0")}`;

export const TCUTZ_ID = fid(1, 1);
export const STAFF_DIEM = fid(2, 1);
export const STAFF_SAMPLE = fid(2, 2);

const SALON_HOURS: WeeklyHours = {
  0: [{ open: "12:00", close: "17:00" }],
  1: [{ open: "10:00", close: "19:00" }],
  2: [{ open: "10:00", close: "19:00" }],
  3: [{ open: "10:00", close: "19:00" }],
  4: [{ open: "10:00", close: "19:00" }],
  5: [{ open: "10:00", close: "19:00" }],
  6: [{ open: "10:00", close: "19:00" }],
};

export const tcutzSalon: Salon = {
  id: TCUTZ_ID,
  slug: "tcutz",
  name: "Tcutz Barber & Salon",
  timezone: "America/Chicago",
  phone: "+17633150044",
  address: "9540 Noble Pkwy N, Minneapolis, MN 55443",
  websiteUrl: "https://www.tcutz-salon.com/",
  isDemo: true,
  brand: { primary: "#1C1B1A", accent: "#C9A96E", background: "#F5F0E8" },
  ownerFirstName: "Diem",
  providerNumber: "+17635550100", // fictional demo number
  settings: {
    slotIntervalMinutes: 15,
    minBookingNoticeMinutes: 60,
    maxAdvanceDays: 60,
    holdMinutes: 5,
    businessHours: SALON_HOURS, // from tcutz-salon.com — confirm with owner
    closedDates: [],
    supportedLanguages: ["en", "vi"],
    defaultLanguage: "en",
    manageLinkTtlDays: 30,
    quietHours: { start: "20:00", end: "09:00" },
    missedCallTextBack: { enabled: true, dedupeHours: 12, upcomingWindowDays: 14 },
  },
};

type SvcSeed = [n: number, en: string, vi: string, dollars: number, type: "fixed" | "starting_at", minutes: number, opts?: Partial<Service>];
const SVC: SvcSeed[] = [
  [1, "Men's haircut", "Cắt tóc nam", 30, "starting_at", 30],
  [2, "Women's haircut", "Cắt tóc nữ", 45, "starting_at", 45],
  [3, "Beard trim", "Tỉa râu", 20, "fixed", 15],
  [4, "Child haircut", "Cắt tóc trẻ em", 25, "fixed", 30],
  [5, "Color", "Nhuộm tóc", 80, "starting_at", 120, { requiresApproval: true, cleanupMinutes: 10 }],
  [6, "Highlights", "Highlight", 80, "starting_at", 120, { requiresApproval: true, cleanupMinutes: 10 }],
  [7, "Perm", "Uốn tóc", 85, "starting_at", 120, { requiresApproval: true, cleanupMinutes: 10 }],
  [8, "Updo", "Búi tóc", 60, "starting_at", 60],
  [9, "Men's haircut + shampoo", "Cắt tóc nam + gội", 35, "fixed", 40],
  [10, "Men's haircut + beard trim", "Cắt tóc nam + tỉa râu", 40, "fixed", 45],
  [11, "Senior haircut", "Cắt tóc người cao tuổi", 20, "fixed", 30],
  [12, "Eyebrow wax", "Wax lông mày", 16, "fixed", 15],
];

export const tcutzServices: Service[] = SVC.map(([n, en, vi, dollars, type, minutes, opts]) => ({
  id: fid(3, n),
  salonId: TCUTZ_ID,
  nameEn: en,
  nameVi: vi,
  priceCents: dollars * 100,
  priceType: type,
  durationMinutes: minutes, // PROVISIONAL — owner must approve before launch
  processingMinutes: 0,
  cleanupMinutes: 0,
  requiresApproval: false,
  onlineBookable: true,
  aiBookable: true,
  isActive: true,
  sortOrder: n,
  ...opts,
}));

export const SVC_ID = {
  mens: fid(3, 1),
  womens: fid(3, 2),
  beard: fid(3, 3),
  child: fid(3, 4),
  color: fid(3, 5),
  mensShampoo: fid(3, 9),
  mensBeard: fid(3, 10),
  senior: fid(3, 11),
  brow: fid(3, 12),
};

export const tcutzStaff: Staff[] = [
  {
    id: STAFF_DIEM,
    salonId: TCUTZ_ID,
    displayName: "Diem",
    color: "#C9A96E",
    isActive: true,
    isBookableOnline: true,
    sortOrder: 1,
    workingHours: SALON_HOURS,
    services: tcutzServices.map((s) => ({ serviceId: s.id })),
  },
  {
    id: STAFF_SAMPLE,
    salonId: TCUTZ_ID,
    displayName: "Sample Stylist",
    color: "#7FA39B",
    isActive: true,
    isBookableOnline: true,
    sortOrder: 2,
    workingHours: {
      2: [{ open: "10:00", close: "18:00" }],
      3: [{ open: "10:00", close: "18:00" }],
      4: [{ open: "10:00", close: "18:00" }],
      5: [{ open: "10:00", close: "18:00" }],
      6: [{ open: "10:00", close: "18:00" }],
    },
    // Cuts only; slightly slower on women's cuts (staff-specific duration example).
    services: [
      { serviceId: SVC_ID.mens },
      { serviceId: SVC_ID.womens, durationOverrideMinutes: 60 },
      { serviceId: SVC_ID.beard },
      { serviceId: SVC_ID.child },
      { serviceId: SVC_ID.mensShampoo },
      { serviceId: SVC_ID.mensBeard },
      { serviceId: SVC_ID.senior },
    ],
  },
];

// ---------------- synthetic customers (555-01xx numbers are reserved for fiction) ----------------
type CustSeed = [n: number, first: string, last: string, phoneSuffix: string, lang: "en" | "vi", usual: string, visits: number, avgCents: number, extra?: Partial<Customer>];
const CUST: CustSeed[] = [
  [1, "Minh", "Nguyen", "0101", "vi", SVC_ID.mens, 14, 3000, { photoConsent: true }],
  [2, "Bao", "Nguyen", "0101", "vi", SVC_ID.child, 6, 2500, { notes: "Minh's son — shares household phone." }],
  [3, "Robert", "Anderson", "0102", "en", SVC_ID.senior, 22, 2000, { notes: "Prefers Tuesday mornings. Hard of hearing — speak clearly. Calls from a landline." }],
  [4, "Linh", "Tran", "0103", "vi", SVC_ID.womens, 8, 5500, { photoConsent: true }],
  [5, "Marcus", "Johnson", "0104", "en", SVC_ID.mensBeard, 11, 4000, { photoConsent: true }],
  [6, "Hoa", "Pham", "0105", "vi", SVC_ID.color, 4, 9500, { notes: "Color client. Patch test on file." }],
  [7, "Emily", "Larson", "0106", "en", SVC_ID.womens, 3, 4500],
  [8, "Tuan", "Le", "0107", "vi", SVC_ID.mens, 9, 3000, { noShowCount: 1 }],
  [9, "David", "Olson", "0108", "en", SVC_ID.mensShampoo, 5, 3500],
  [10, "Mai", "Vo", "0109", "vi", SVC_ID.brow, 7, 1600],
];

export function buildCustomers(today: string): Customer[] {
  return CUST.map(([n, first, last, suffix, lang, usual, visits, avgCents, extra]) => {
    const lastVisit = new Date(`${today}T17:00:00Z`);
    lastVisit.setUTCDate(lastVisit.getUTCDate() - (7 + ((n * 5) % 28)));
    const firstVisit = new Date(lastVisit);
    firstVisit.setUTCDate(firstVisit.getUTCDate() - visits * 25);
    return {
      id: fid(4, n),
      salonId: TCUTZ_ID,
      firstName: first,
      lastName: last,
      phoneE164: `+1763555${suffix}`,
      preferredLanguage: lang,
      preferredStaffId: STAFF_DIEM,
      usualServiceId: usual,
      firstVisitAt: firstVisit.toISOString(),
      lastVisitAt: lastVisit.toISOString(),
      completedVisits: visits,
      lifetimeSpendCents: visits * avgCents,
      noShowCount: 0,
      cancelCount: 0,
      smsTransactionalConsent: true,
      smsMarketingConsent: false,
      photoConsent: false,
      isSynthetic: true,
      createdAt: firstVisit.toISOString(),
      ...extra,
    };
  });
}

export function buildHaircutProfiles(today: string): HaircutProfile[] {
  const at = `${today}T15:00:00Z`;
  return [
    { customerId: fid(4, 1), style: "Low skin fade, textured crop", clipperGuard: "0 → 2 on sides, blend to 4", fadeType: "Low skin fade", topLength: "1.5 in, point cut", hairline: "Natural, no line-up", stylistNotes: "Cowlick at crown — leave extra length there.", updatedAt: at },
    { customerId: fid(4, 2), style: "Short taper", clipperGuard: "3 sides, scissor top", topLength: "1 in", stylistNotes: "Gets fidgety — keep it quick, iPad helps.", updatedAt: at },
    { customerId: fid(4, 3), style: "Classic side part", clipperGuard: "4 sides & back", sideLength: "Tapered", topLength: "2 in, scissor", hairline: "Tidy neckline, rounded", beard: "Trim eyebrows lightly", updatedAt: at },
    { customerId: fid(4, 4), style: "Long layers, curtain bangs", sideLength: "Collarbone", backLength: "Mid-back, remove 1 in", scissorNotes: "Point cut ends; dry cut bangs", products: "Light leave-in", updatedAt: at },
    { customerId: fid(4, 5), style: "Mid drop fade + beard shape", clipperGuard: "1 → 3", fadeType: "Mid drop fade", hairline: "Sharp line-up", beard: "Keep 1/2 in, sharp cheek line, fade into sideburns", updatedAt: at },
    { customerId: fid(4, 6), style: "Shoulder-length bob", colorFormula: "6N + 6.3 (1:1), 20 vol, 35 min", products: "Color-safe shampoo", stylistNotes: "Gray coverage at temples.", updatedAt: at },
    { customerId: fid(4, 8), style: "Two-block", clipperGuard: "2 underneath", topLength: "3 in, scissor", updatedAt: at },
    { customerId: fid(4, 9), style: "Ivy league", clipperGuard: "3 sides", topLength: "1.5 in", updatedAt: at },
  ];
}

export function buildHaircutHistory(today: string): HaircutHistoryEntry[] {
  const back = (days: number) => {
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - days);
    return d.toISOString().slice(0, 10);
  };
  return [
    { id: fid(5, 1), customerId: fid(4, 1), staffId: STAFF_DIEM, cutOn: back(12), snapshot: { style: "Low skin fade, textured crop", clipperGuard: "0 → 2, blend to 4", topLength: "1.5 in" }, customerFeedback: "Perfect, same next time.", photos: [], createdAt: `${back(12)}T18:00:00Z` },
    { id: fid(5, 2), customerId: fid(4, 1), staffId: STAFF_DIEM, cutOn: back(40), snapshot: { style: "Mid fade, textured crop", clipperGuard: "1 → 3", topLength: "2 in" }, customerFeedback: "A little long on top.", photos: [], createdAt: `${back(40)}T18:00:00Z` },
    { id: fid(5, 3), customerId: fid(4, 1), staffId: STAFF_DIEM, cutOn: back(70), snapshot: { style: "Mid fade, comb over", clipperGuard: "1 → 3", topLength: "2.5 in" }, photos: [], createdAt: `${back(70)}T18:00:00Z` },
    { id: fid(5, 4), customerId: fid(4, 3), staffId: STAFF_DIEM, cutOn: back(21), snapshot: { style: "Classic side part", clipperGuard: "4", topLength: "2 in" }, photos: [], createdAt: `${back(21)}T16:00:00Z` },
    { id: fid(5, 5), customerId: fid(4, 5), staffId: STAFF_DIEM, cutOn: back(14), snapshot: { style: "Mid drop fade + beard shape", clipperGuard: "1 → 3", beard: "1/2 in" }, photos: [], createdAt: `${back(14)}T20:00:00Z` },
    { id: fid(5, 6), customerId: fid(4, 6), staffId: STAFF_DIEM, cutOn: back(42), snapshot: { style: "Bob", colorFormula: "6N + 6.3 (1:1), 20 vol, 35 min" }, customerFeedback: "Color lasted well.", photos: [], createdAt: `${back(42)}T19:00:00Z` },
  ];
}

/** Demo appointments for "today" and the next few days, in local salon time. */
export interface DemoAppointmentSeed {
  n: number;
  dayOffset: number;
  time: string; // local HH:mm
  staffId: string;
  customerN?: number;
  serviceIds: string[];
  status: AppointmentStatus;
  source: AppointmentSource;
  note?: string;
}

export const DEMO_APPOINTMENTS: DemoAppointmentSeed[] = [
  { n: 1, dayOffset: 0, time: "10:00", staffId: STAFF_DIEM, customerN: 3, serviceIds: [SVC_ID.senior], status: "completed", source: "ai_phone" },
  { n: 2, dayOffset: 0, time: "10:45", staffId: STAFF_DIEM, customerN: 1, serviceIds: [SVC_ID.mens], status: "completed", source: "rebooking" },
  { n: 3, dayOffset: 0, time: "11:30", staffId: STAFF_SAMPLE, customerN: 2, serviceIds: [SVC_ID.child], status: "completed", source: "manual" },
  { n: 4, dayOffset: 0, time: "13:00", staffId: STAFF_DIEM, customerN: 6, serviceIds: [SVC_ID.color], status: "in_progress", source: "manual", note: "Gray coverage" },
  { n: 5, dayOffset: 0, time: "15:30", staffId: STAFF_DIEM, customerN: 5, serviceIds: [SVC_ID.mensBeard], status: "booked", source: "ai_phone" },
  { n: 6, dayOffset: 0, time: "16:30", staffId: STAFF_DIEM, customerN: 9, serviceIds: [SVC_ID.mensShampoo], status: "confirmed", source: "website" },
  { n: 7, dayOffset: 0, time: "14:00", staffId: STAFF_SAMPLE, customerN: 8, serviceIds: [SVC_ID.mens], status: "booked", source: "ai_phone" },
  { n: 8, dayOffset: 0, time: "17:15", staffId: STAFF_DIEM, customerN: 10, serviceIds: [SVC_ID.brow], status: "booked", source: "website" },
  { n: 9, dayOffset: 1, time: "10:30", staffId: STAFF_DIEM, customerN: 4, serviceIds: [SVC_ID.womens], status: "booked", source: "website" },
  { n: 10, dayOffset: 1, time: "12:00", staffId: STAFF_DIEM, customerN: 7, serviceIds: [SVC_ID.womens], status: "booked", source: "ai_phone" },
  { n: 11, dayOffset: 2, time: "11:00", staffId: STAFF_DIEM, customerN: 3, serviceIds: [SVC_ID.senior], status: "booked", source: "rebooking" },
];
