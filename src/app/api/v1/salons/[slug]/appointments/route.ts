import { getStore } from "@/lib/data";
import { bookPublic } from "@/lib/booking/service";
import { idempotencyKey, publicBookingBody } from "@/lib/validation";
import { bookingError, jsonError, limited, ok, validationError } from "@/lib/http";

// POST /api/v1/salons/:slug/appointments   (header: Idempotency-Key)
export async function POST(req: Request, ctx: RouteContext<"/api/v1/salons/[slug]/appointments">) {
  const rl = limited(req, "book", 10, 10 * 60_000);
  if (rl) return rl;
  const key = idempotencyKey.safeParse(req.headers.get("idempotency-key"));
  if (!key.success) return jsonError("IDEMPOTENCY_KEY_REQUIRED", 400);

  const json = await req.json().catch(() => null);
  const parsed = publicBookingBody.safeParse(json);
  if (!parsed.success) return validationError(parsed.error);

  const { slug } = await ctx.params;
  const store = await getStore("public");
  const salon = await store.getSalonBySlug(slug);
  if (!salon) return jsonError("SALON_NOT_FOUND", 404);

  const res = await bookPublic(store, salon, parsed.data, `web-${key.data}`);
  if (!res.ok) return bookingError(res.error);
  const a = res.value.appointment;
  // Return only what the confirmation screen needs.
  return ok(
    {
      appointmentId: a.id,
      status: a.status,
      startsAt: a.startsAt,
      endsAt: a.endsAt,
      staffId: a.staffId,
      estimatedPriceCents: a.estimatedPriceCents,
      manageUrl: res.value.manageUrl,
    },
    res.value.created ? 201 : 200,
  );
}
