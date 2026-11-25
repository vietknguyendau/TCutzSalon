import { NextResponse } from "next/server";
import { getStore } from "@/lib/data";
import { processCallEnded } from "@/lib/textback/service";
import { readTwilioWebhook } from "@/lib/twilio-webhook";

const FINAL = new Set(["completed", "busy", "no-answer", "failed", "canceled"]);

// Twilio "call status changes" callback (configure on the phone number). Fires when the call ends.
export async function POST(req: Request) {
  const r = await readTwilioWebhook(req);
  if ("response" in r) return r.response;
  const p = r.params;
  if (!FINAL.has(p.CallStatus)) return new NextResponse(null, { status: 204 });

  const store = await getStore("public");
  const salon = await store.findSalonByProviderNumber(p.To ?? "");
  if (!salon) return new NextResponse(null, { status: 204 });

  const call = await store.getCall("twilio", p.CallSid);
  const duration = Number(p.CallDuration);
  await processCallEnded(store, salon, {
    provider: "twilio",
    externalCallId: p.CallSid,
    from: p.From ?? null,
    // Before the AI receptionist exists, every forwarded call is one nobody answered.
    outcome: p.CallStatus === "failed" ? "failed" : "missed",
    language: call?.language,
    durationSeconds: Number.isFinite(duration) ? duration : undefined,
  });
  return new NextResponse(null, { status: 204 });
}
