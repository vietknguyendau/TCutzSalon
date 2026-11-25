import { NextResponse } from "next/server";
import { getStore } from "@/lib/data";
import { readTwilioWebhook } from "@/lib/twilio-webhook";

// Delivery receipts → notifications.status, so failing numbers/integrations show up in the dashboard.
export async function POST(req: Request) {
  const r = await readTwilioWebhook(req);
  if ("response" in r) return r.response;
  const { MessageSid, MessageStatus, ErrorCode } = r.params;
  if (MessageSid && (MessageStatus === "delivered" || MessageStatus === "undelivered" || MessageStatus === "failed")) {
    const store = await getStore("public");
    await store.markNotificationByProviderId(MessageSid, MessageStatus === "delivered" ? "delivered" : "failed", ErrorCode ? `Twilio ${ErrorCode}` : undefined);
  }
  return new NextResponse(null, { status: 204 });
}
