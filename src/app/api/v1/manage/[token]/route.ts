import { getStore } from "@/lib/data";
import { cancelByCustomer, readManageToken } from "@/lib/booking/service";
import { bookingError, jsonError, limited, ok } from "@/lib/http";

async function load(token: string) {
  const t = readManageToken(token);
  if (!t) return null;
  const store = await getStore("public");
  const salon = await store.getSalonById(t.sid);
  if (!salon) return null;
  const appt = await store.getAppointment(salon.id, t.sub);
  return appt ? { store, salon, appt } : null;
}

export async function GET(req: Request, ctx: RouteContext<"/api/v1/manage/[token]">) {
  const rl = limited(req, "manage", 30, 60_000);
  if (rl) return rl;
  const found = await load((await ctx.params).token);
  if (!found) return jsonError("LINK_INVALID_OR_EXPIRED", 404);
  const { appt } = found;
  return ok({ status: appt.status, startsAt: appt.startsAt, services: appt.services.map((s) => s.name) });
}

export async function DELETE(req: Request, ctx: RouteContext<"/api/v1/manage/[token]">) {
  const rl = limited(req, "manage-cancel", 5, 60_000);
  if (rl) return rl;
  const found = await load((await ctx.params).token);
  if (!found) return jsonError("LINK_INVALID_OR_EXPIRED", 404);
  const res = await cancelByCustomer(found.store, found.salon, found.appt.id);
  return res.ok ? ok({ status: res.value.status }) : bookingError(res.error);
}
