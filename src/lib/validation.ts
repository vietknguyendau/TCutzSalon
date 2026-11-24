import { z } from "zod";
import { APPOINTMENT_SOURCES, APPOINTMENT_STATUSES } from "./domain/types";
import { isValidDateString } from "./scheduling/time";
import { toE164US } from "./phone";

export const uuid = z.string().uuid();
export const localDate = z.string().refine(isValidDateString, "Expected YYYY-MM-DD");
export const usPhone = z
  .string()
  .max(32)
  .transform((v, ctx) => {
    const e = toE164US(v);
    if (!e) {
      ctx.addIssue({ code: "custom", message: "Enter a valid US phone number" });
      return z.NEVER;
    }
    return e;
  });
export const lang = z.enum(["en", "vi"]);
const name = z.string().trim().min(1).max(60).regex(/^[\p{L}\p{M}' .-]+$/u, "Letters only");

export const availabilityQuery = z.object({
  serviceId: uuid,
  date: localDate,
  staffId: uuid.optional(),
});

export const idempotencyKey = z.string().min(8).max(100).regex(/^[A-Za-z0-9_-]+$/);

export const publicBookingBody = z.object({
  serviceId: uuid,
  addonServiceIds: z.array(uuid).max(3).default([]),
  staffId: uuid.optional(), // omitted = first available
  startsAt: z.string().datetime({ offset: true }),
  firstName: name,
  lastName: name.optional(),
  phone: usPhone,
  language: lang,
  smsConsent: z.boolean(),
  note: z.string().trim().max(300).optional(),
  // Returning-customer path: must present a verified-phone token for the same phone.
  customerId: uuid.optional(),
  verifiedToken: z.string().max(1024).optional(),
});
export type PublicBookingBody = z.infer<typeof publicBookingBody>;

export const verifyStartBody = z.object({ phone: usPhone, language: lang.default("en") });
export const verifyCheckBody = z.object({ phone: usPhone, code: z.string().regex(/^\d{6}$/) });

export const staffBookingBody = z.object({
  serviceId: uuid,
  addonServiceIds: z.array(uuid).max(3).default([]),
  staffId: uuid,
  startsAt: z.string().datetime({ offset: true }),
  customerId: uuid.optional(),
  firstName: name.optional(),
  lastName: name.optional(),
  phone: z.union([usPhone, z.literal("")]).optional(),
  source: z.enum(APPOINTMENT_SOURCES),
  note: z.string().trim().max(300).optional(),
  idempotencyKey,
});

export const statusChangeBody = z.object({
  appointmentId: uuid,
  status: z.enum(APPOINTMENT_STATUSES),
  finalPriceCents: z.number().int().min(0).max(1_000_000).optional(),
});

export const haircutProfileBody = z.object({
  customerId: uuid,
  style: z.string().max(200).optional(),
  clipperGuard: z.string().max(100).optional(),
  fadeType: z.string().max(100).optional(),
  sideLength: z.string().max(100).optional(),
  topLength: z.string().max(100).optional(),
  backLength: z.string().max(100).optional(),
  scissorNotes: z.string().max(300).optional(),
  hairline: z.string().max(200).optional(),
  beard: z.string().max(200).optional(),
  colorFormula: z.string().max(300).optional(),
  products: z.string().max(200).optional(),
  stylistNotes: z.string().max(1000).optional(),
  customerFeedback: z.string().max(500).optional(),
});
