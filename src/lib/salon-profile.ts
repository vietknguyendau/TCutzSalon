// Editable salon profile (name, owner, phone, address). Shared by the Settings form, the demo
// branding cookie and the share link. Pure — no Next.js imports — so it's unit-testable.
import { z } from "zod";
import { toE164US } from "./phone";

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((v) => !/[<>{}]/.test(v), "No special characters");

export const salonProfileSchema = z.object({
  name: text(60).pipe(z.string().min(2, "Salon name is required")),
  ownerFirstName: text(30).optional().transform((v) => v || undefined),
  ownerTitleVi: z.enum(["", "chị", "anh", "cô", "chú", "bà", "ông"]).optional().transform((v) => v || undefined),
  phone: z
    .string()
    .trim()
    .max(32)
    .optional()
    .transform((v, ctx) => {
      if (!v) return undefined;
      const e = toE164US(v);
      if (!e) {
        ctx.addIssue({ code: "custom", message: "Enter a valid US phone number" });
        return z.NEVER;
      }
      return e;
    }),
  address: text(120).optional().transform((v) => v || undefined),
});
export type SalonProfile = z.infer<typeof salonProfileSchema>;

export const DEMO_BRAND_COOKIE = "demo_brand";
export const DEMO_BRAND_PARAM = "brand";

/** Compact URL/cookie-safe encoding of a demo profile. */
export function encodeProfile(p: SalonProfile): string {
  return Buffer.from(JSON.stringify(p), "utf8").toString("base64url");
}

/** Decodes and re-validates — cookie and link values are user-controlled. Returns null if invalid. */
export function decodeProfile(raw: string | undefined | null): SalonProfile | null {
  if (!raw || raw.length > 1200 || !/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  try {
    const parsed = salonProfileSchema.safeParse(JSON.parse(Buffer.from(raw, "base64url").toString("utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
