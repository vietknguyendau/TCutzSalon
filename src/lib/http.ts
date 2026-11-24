import "server-only";
import { NextResponse } from "next/server";
import type { ZodError } from "zod";
import type { BookingFailure } from "./booking/service";
import { clientIp, rateLimit } from "./rate-limit";

const STATUS: Record<BookingFailure, number> = {
  SLOT_TAKEN: 409,
  SLOT_HELD: 409,
  SLOT_UNAVAILABLE: 409,
  STAFF_UNAVAILABLE: 409,
  STAFF_NOT_QUALIFIED: 422,
  INVALID_SERVICE: 422,
  INVALID_STAFF: 422,
  INVALID_CUSTOMER: 422,
  INVALID_TRANSITION: 409,
  SERVICE_NOT_FOUND: 404,
  NOT_FOUND: 404,
  VERIFICATION_REQUIRED: 401,
};

export const jsonError = (error: string, status: number, extra?: Record<string, unknown>) =>
  NextResponse.json({ ok: false, error, ...extra }, { status, headers: { "Cache-Control": "no-store" } });

export const bookingError = (e: BookingFailure) => jsonError(e, STATUS[e] ?? 400);

export const validationError = (e: ZodError) =>
  jsonError("VALIDATION_FAILED", 400, { issues: e.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });

export const ok = <T>(data: T, status = 200) =>
  NextResponse.json({ ok: true, data }, { status, headers: { "Cache-Control": "no-store" } });

/** Returns a 429 response if the caller exceeded the limit, else null. */
export function limited(req: Request, bucket: string, limit: number, windowMs: number, extraKey = "") {
  // Test-only escape hatch (e2e runs every request from one IP). Ignored unless in demo mode.
  if (process.env.E2E_DISABLE_RATE_LIMIT === "1" && (process.env.DATA_MODE ?? "demo") === "demo") return null;
  const r = rateLimit(`${bucket}:${clientIp(req.headers)}:${extraKey}`, limit, windowMs);
  return r.ok ? null : jsonError("RATE_LIMITED", 429, { retryAfterSec: r.retryAfterSec });
}
