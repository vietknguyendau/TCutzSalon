import "server-only";
// Orchestrates missed-call text-back. Provider-agnostic: Twilio webhooks today, the AI receptionist's
// end-of-call event later — both call processCallEnded() with the same shape.

import type { CallOutcome, CallbackRequest, Lang, NotificationRecord, Salon } from "../domain/types";
import { isActiveStatus } from "../domain/types";
import type { DataStore } from "../data/store";
import { env } from "../env";
import { smsProviderFor, type SmsProvider } from "../providers/sms";
import { formatPhoneUS } from "../phone";
import { classifyInbound, decideTextBack, type Decision, type InboundIntent } from "./decide";

const TEXT_BACK_TEMPLATES = ["missed_call_text_back", "missed_call_upcoming"];

export interface CallEndedEvent {
  provider: string;
  externalCallId: string;
  from: string | null;
  outcome: CallOutcome;
  language?: Lang;
  startedAt?: string;
  endedAt?: string;
  durationSeconds?: number;
}

export type CallEndedResult =
  | { status: "duplicate" }
  | { status: "processed"; decision: Decision; notification?: NotificationRecord; callback?: CallbackRequest };

export function bookingLink(salon: Salon, lang: Lang): string {
  const url = new URL(salon.settings.publicBookingUrl ?? `${env().NEXT_PUBLIC_APP_URL}/book/${salon.slug}`);
  url.searchParams.set("r", "m"); // attribution: booked after a missed-call text
  if (lang === "vi") url.searchParams.set("lang", "vi");
  return url.toString();
}

export async function processCallEnded(
  store: DataStore,
  salon: Salon,
  ev: CallEndedEvent,
  opts: { now?: Date; provider?: SmsProvider } = {},
): Promise<CallEndedResult> {
  const now = opts.now ?? new Date();
  // Providers retry webhooks; a call is processed at most once.
  if (!(await store.recordWebhookEvent(ev.provider, `call-ended:${ev.externalCallId}`, ev, salon.id))) return { status: "duplicate" };

  await store.upsertCall({
    salonId: salon.id,
    provider: ev.provider,
    externalCallId: ev.externalCallId,
    fromE164: ev.from ?? undefined,
    language: ev.language,
    startedAt: ev.startedAt,
    endedAt: ev.endedAt ?? now.toISOString(),
    durationSeconds: ev.durationSeconds,
    outcome: ev.outcome,
  });

  const from = ev.from && /^\+1\d{10}$/.test(ev.from) ? ev.from : null;
  const household = from ? await store.findCustomersByPhone(salon.id, from) : [];
  const customer = household[0];
  const lang = ev.language ?? customer?.preferredLanguage;

  let upcoming: { startsAt: Date } | undefined;
  for (const c of household) {
    const next = (await store.listCustomerAppointments(salon.id, c.id))
      .filter((a) => isActiveStatus(a.status) && a.status !== "completed" && new Date(a.startsAt) > now)
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
    if (next && (!upcoming || new Date(next.startsAt) < upcoming.startsAt)) upcoming = { startsAt: new Date(next.startsAt) };
  }

  const provider = opts.provider ?? (await smsProviderFor(salon, env().SMS_PROVIDER));
  const input = {
    salon,
    bookingUrl: bookingLink(salon, lang ?? salon.settings.defaultLanguage),
    from,
    outcome: ev.outcome,
    now,
    optedOut: from ? await store.isOptedOut(salon.id, from) : false,
    lastTextBackAt: from ? await store.lastNotificationAt(salon.id, from, TEXT_BACK_TEMPLATES) : null,
    callerLanguage: lang,
    knownFirstName: customer?.firstName,
    upcoming,
  };
  // Cheap rules first; only pay for a line-type lookup when we'd actually text.
  let decision = decideTextBack({ ...input, lineType: "unknown" });
  if (decision.action !== "skip" && from) decision = decideTextBack({ ...input, lineType: await provider.lookupLineType(from) });

  if (decision.action === "skip") {
    if (decision.createCallback && from) {
      const callback = await store.createCallback({
        salonId: salon.id,
        customerId: customer?.id,
        phoneE164: from,
        name: customer ? [customer.firstName, customer.lastName].filter(Boolean).join(" ") : undefined,
        reason: "landline_missed_call",
        language: lang,
      });
      return { status: "processed", decision, callback };
    }
    return { status: "processed", decision };
  }

  const notification = await store.createNotification({
    salonId: salon.id,
    customerId: customer?.id,
    channel: "sms",
    category: "transactional",
    template: decision.template,
    toAddress: from!,
    body: decision.body,
    status: "queued",
    scheduledFor: (decision.action === "schedule" ? decision.sendAt : now).toISOString(),
  });
  if (decision.action === "send") {
    const sent = await deliver(store, provider, salon, notification);
    return { status: "processed", decision, notification: sent };
  }
  return { status: "processed", decision, notification };
}

async function deliver(store: DataStore, provider: SmsProvider, salon: Salon, n: NotificationRecord): Promise<NotificationRecord> {
  try {
    const r = await provider.send({ to: n.toAddress, from: salon.providerNumber, body: n.body, category: n.category, salonId: salon.id });
    const patch = { status: r.status, providerMessageId: r.providerMessageId, sentAt: new Date().toISOString(), segments: r.segments, provider: provider.name };
    await store.updateNotification(n.id, patch);
    return { ...n, ...patch };
  } catch (e) {
    const error = e instanceof Error ? e.message.slice(0, 500) : "send failed";
    await store.updateNotification(n.id, { status: "failed", error });
    return { ...n, status: "failed", error };
  }
}

/** Cron: send texts that were held for quiet hours. Re-checks opt-out right before sending. */
export async function dispatchDueNotifications(store: DataStore, now = new Date()) {
  const due = await store.listDueNotifications(now, 100);
  let sent = 0;
  let suppressed = 0;
  for (const n of due) {
    const salon = await store.getSalonById(n.salonId);
    if (!salon) continue;
    if (await store.isOptedOut(salon.id, n.toAddress)) {
      await store.updateNotification(n.id, { status: "suppressed", error: "opted out before send" });
      suppressed++;
      continue;
    }
    const r = await deliver(store, await smsProviderFor(salon, env().SMS_PROVIDER), salon, n);
    if (r.status !== "failed") sent++;
  }
  return { due: due.length, sent, suppressed };
}

// ---------------- inbound SMS ----------------
export interface InboundResult {
  intent: InboundIntent;
  reply: string | null; // returned as TwiML; null = no reply (carrier handles STOP/START confirmations)
}

export async function handleInboundSms(store: DataStore, salon: Salon, fromRaw: string, body: string, now = new Date()): Promise<InboundResult> {
  const from = /^\+1\d{10}$/.test(fromRaw) ? fromRaw : null;
  const intent = classifyInbound(body);
  if (!from) return { intent, reply: null };
  const customer = (await store.findCustomersByPhone(salon.id, from))[0];
  const vi = customer?.preferredLanguage === "vi" || /[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i.test(body) || /^\s*g[oọ]i/i.test(body);
  const lang: Lang = vi ? "vi" : "en";
  const short = salon.name.split(/\s+(?:Barber|Salon|&)/)[0];
  const ownerEn = salon.ownerFirstName ?? "The salon";
  const ownerVi = salon.ownerFirstName ? `${salon.ownerTitleVi ? `${salon.ownerTitleVi} ` : ""}${salon.ownerFirstName}` : "tiệm";
  const name = customer ? [customer.firstName, customer.lastName].filter(Boolean).join(" ") : undefined;

  switch (intent) {
    case "opt_out":
      await store.setOptOut(salon.id, from, true, "sms_keyword");
      return { intent, reply: null };
    case "opt_in":
      await store.setOptOut(salon.id, from, false, "sms_keyword");
      return { intent, reply: null };
    case "help":
      return {
        intent,
        reply: `${short}: Book at ${bookingLink(salon, lang)} or call ${formatPhoneUS(salon.phone)}. Reply STOP to opt out.`,
      };
    case "callback":
      await store.createCallback({ salonId: salon.id, customerId: customer?.id, phoneE164: from, name, reason: "customer_asked", language: lang });
      return {
        intent,
        reply: lang === "vi" ? `${short}: Dạ, ${ownerVi} sẽ gọi lại cho anh/chị sớm ạ.` : `${short}: Thanks! ${ownerEn} will call you back soon.`,
      };
    default: {
      await store.createCallback({ salonId: salon.id, customerId: customer?.id, phoneE164: from, name, reason: "sms_reply", message: body.slice(0, 500), language: lang });
      // At most one auto-reply per hour per number so a back-and-forth doesn't become a bot loop.
      const last = await store.lastNotificationAt(salon.id, from, ["sms_auto_reply"]);
      if (last && now.getTime() - last.getTime() < 3_600_000) return { intent, reply: null };
      const reply =
        lang === "vi"
          ? `${short}: Tiệm đã nhận tin nhắn và sẽ trả lời sớm. Đặt lịch: ${bookingLink(salon, "vi")}`
          : `${short}: Got your message — we'll get back to you soon. Book anytime: ${bookingLink(salon, "en")}`;
      await store.createNotification({
        salonId: salon.id, customerId: customer?.id, channel: "sms", category: "transactional", template: "sms_auto_reply",
        toAddress: from, body: reply, status: "sent", provider: "reply", scheduledFor: now.toISOString(), sentAt: now.toISOString(),
      });
      return { intent, reply };
    }
  }
}
