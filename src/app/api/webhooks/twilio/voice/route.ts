import { getStore } from "@/lib/data";
import { readTwilioWebhook, say, twiml } from "@/lib/twilio-webhook";

// Incoming call to the salon's Twilio number (calls the owner didn't pick up are forwarded here).
// Phase 2a: no AI yet — greet, offer Vietnamese, promise a text, hang up. The text is sent from
// /voice-status once the call ends. Phase 2b replaces this TwiML with a hand-off to the AI agent.
export async function POST(req: Request) {
  const r = await readTwilioWebhook(req);
  if ("response" in r) return r.response;
  const p = r.params;
  const store = await getStore("public");
  const salon = await store.findSalonByProviderNumber(p.To ?? "");
  if (!salon) return twiml(`${say("Sorry, this number is not in service.")}<Hangup/>`);

  const step = new URL(req.url).searchParams.get("step");
  const short = salon.name.split(/\s+(?:Barber|Salon|&)/)[0];

  if (step === "lang") {
    const vi = p.Digits === "2";
    await store.upsertCall({ salonId: salon.id, provider: "twilio", externalCallId: p.CallSid, language: vi ? "vi" : "en" });
    return twiml(
      vi
        ? `${say(`Dạ, cảm ơn anh chị đã gọi ${short}. Tiệm sẽ nhắn tin đường dẫn đặt lịch cho anh chị ngay. Chào anh chị ạ.`, "vi")}<Hangup/>`
        : `${say("Thanks! Goodbye.")}<Hangup/>`,
    );
  }

  await store.upsertCall({
    salonId: salon.id,
    provider: "twilio",
    externalCallId: p.CallSid,
    fromE164: p.From,
    startedAt: new Date().toISOString(),
  });
  const action = `${new URL(req.url).pathname}?step=lang`;
  return twiml(
    `<Gather numDigits="1" timeout="4" action="${action}" method="POST">` +
      say(`Thanks for calling ${short}. We're with a customer right now, so we'll text you a link to book online.`) +
      say("Để nghe tiếng Việt, xin bấm số 2.", "vi") +
      `</Gather>${say("Talk to you soon. Goodbye.")}<Hangup/>`,
  );
}
