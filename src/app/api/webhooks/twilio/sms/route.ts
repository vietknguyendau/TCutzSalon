import { getStore } from "@/lib/data";
import { handleInboundSms } from "@/lib/textback/service";
import { message, readTwilioWebhook, twiml } from "@/lib/twilio-webhook";

// Inbound text to the salon's number: STOP/START/HELP, CALL/GỌI → call-back list, anything else → owner inbox.
export async function POST(req: Request) {
  const r = await readTwilioWebhook(req);
  if ("response" in r) return r.response;
  const p = r.params;
  const store = await getStore("public");
  if (p.MessageSid && !(await store.recordWebhookEvent("twilio", `sms-in:${p.MessageSid}`, { from: p.From, to: p.To }))) return twiml("");
  const salon = await store.findSalonByProviderNumber(p.To ?? "");
  if (!salon) return twiml("");
  const res = await handleInboundSms(store, salon, p.From ?? "", (p.Body ?? "").slice(0, 1600));
  return twiml(res.reply ? message(res.reply) : "");
}
