import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getStore } from "@/lib/data";
import { env } from "@/lib/env";
import { dispatchDueNotifications } from "@/lib/textback/service";

// Sends texts held for quiet hours. Scheduled in vercel.json; Vercel sends Authorization: Bearer $CRON_SECRET.
export async function GET(req: Request) {
  const secret = env().CRON_SECRET;
  const given = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (!secret || given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  const result = await dispatchDueNotifications(await getStore("public"));
  return NextResponse.json(result);
}
