import { getStore } from "@/lib/data";
import { startVerification } from "@/lib/booking/service";
import { verifyStartBody } from "@/lib/validation";
import { jsonError, limited, ok, validationError } from "@/lib/http";

export async function POST(req: Request, ctx: RouteContext<"/api/v1/salons/[slug]/verify/start">) {
  const parsed = verifyStartBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return validationError(parsed.error);
  // Per-IP and per-phone limits (SMS costs money and OTPs can be abused).
  const rl = limited(req, "otp-ip", 5, 15 * 60_000) ?? limited(new Request(req.url), "otp-phone", 3, 15 * 60_000, parsed.data.phone);
  if (rl) return rl;

  const { slug } = await ctx.params;
  const store = await getStore("public");
  const salon = await store.getSalonBySlug(slug);
  if (!salon) return jsonError("SALON_NOT_FOUND", 404);

  const res = await startVerification(store, salon, parsed.data.phone, parsed.data.language);
  return ok(res);
}
