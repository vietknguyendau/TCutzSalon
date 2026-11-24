import { getStore } from "@/lib/data";
import { checkVerification } from "@/lib/booking/service";
import { verifyCheckBody } from "@/lib/validation";
import { bookingError, jsonError, limited, ok, validationError } from "@/lib/http";

export async function POST(req: Request, ctx: RouteContext<"/api/v1/salons/[slug]/verify/check">) {
  const rl = limited(req, "otp-check", 10, 15 * 60_000);
  if (rl) return rl;
  const parsed = verifyCheckBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return validationError(parsed.error);

  const { slug } = await ctx.params;
  const store = await getStore("public");
  const salon = await store.getSalonBySlug(slug);
  if (!salon) return jsonError("SALON_NOT_FOUND", 404);

  const res = await checkVerification(store, salon, parsed.data.phone, parsed.data.code);
  if (!res.ok) return bookingError(res.error);
  return ok(res.value);
}
