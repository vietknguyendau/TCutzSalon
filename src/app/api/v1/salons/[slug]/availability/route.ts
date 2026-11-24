import { getStore } from "@/lib/data";
import { availableSlots } from "@/lib/booking/service";
import { availabilityQuery } from "@/lib/validation";
import { bookingError, jsonError, limited, ok, validationError } from "@/lib/http";

// GET /api/v1/salons/:slug/availability?serviceId=…&date=YYYY-MM-DD[&staffId=…][&channel=ai_phone]
export async function GET(req: Request, ctx: RouteContext<"/api/v1/salons/[slug]/availability">) {
  const rl = limited(req, "availability", 120, 60_000);
  if (rl) return rl;
  const { slug } = await ctx.params;
  const url = new URL(req.url);
  const parsed = availabilityQuery.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return validationError(parsed.error);

  const store = await getStore("public");
  const salon = await store.getSalonBySlug(slug);
  if (!salon) return jsonError("SALON_NOT_FOUND", 404);

  const res = await availableSlots(store, salon, { ...parsed.data, channel: "website" });
  if (!res.ok) return bookingError(res.error);
  return ok({ timezone: salon.timezone, date: parsed.data.date, slots: res.value });
}
