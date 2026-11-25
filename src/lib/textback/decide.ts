// Pure decision logic for missed-call text-back. No I/O — every rule is unit-tested.
import type { CallOutcome, Lang, Salon } from "../domain/types";
import { addDays, hhmmToMinutes, localDateOf, localMinutesOf, localToUtc } from "../scheduling/time";

export type LineType = "mobile" | "landline" | "voip" | "unknown";

export type SkipReason =
  | "DISABLED"
  | "NO_CALLER_ID"
  | "NOT_A_MISSED_CALL"
  | "OPTED_OUT"
  | "LANDLINE"
  | "RECENTLY_TEXTED";

export type Decision =
  | { action: "send"; template: TextBackTemplate; lang: Lang; body: string }
  | { action: "schedule"; template: TextBackTemplate; lang: Lang; body: string; sendAt: Date }
  | { action: "skip"; reason: SkipReason; createCallback: boolean };

export type TextBackTemplate = "missed_call_text_back" | "missed_call_upcoming";

export interface DecisionInput {
  salon: Pick<Salon, "name" | "timezone" | "settings">;
  bookingUrl: string; // already includes ?r=m and lang
  from: string | null; // E.164 or null when caller ID is blocked
  outcome: CallOutcome;
  now: Date;
  lineType: LineType;
  optedOut: boolean;
  lastTextBackAt: Date | null;
  callerLanguage?: Lang; // from IVR choice or known customer
  knownFirstName?: string;
  upcoming?: { startsAt: Date; staffName?: string };
}

/** Outcomes where nobody took care of the caller. AI "info" calls also get the link — they asked but didn't book. */
const NEEDS_FOLLOW_UP: CallOutcome[] = ["missed", "voicemail", "abandoned", "info", "failed"];

export function isMissedOutcome(o: CallOutcome) {
  return NEEDS_FOLLOW_UP.includes(o);
}

export function decideTextBack(i: DecisionInput): Decision {
  const cfg = i.salon.settings.missedCallTextBack;
  if (!cfg.enabled) return { action: "skip", reason: "DISABLED", createCallback: false };
  if (!i.from || !/^\+1\d{10}$/.test(i.from)) return { action: "skip", reason: "NO_CALLER_ID", createCallback: false };
  if (!isMissedOutcome(i.outcome)) return { action: "skip", reason: "NOT_A_MISSED_CALL", createCallback: false };
  if (i.optedOut) return { action: "skip", reason: "OPTED_OUT", createCallback: false };
  // Landlines can't receive texts → put them on the owner's call-back list instead.
  if (i.lineType === "landline") return { action: "skip", reason: "LANDLINE", createCallback: true };
  if (i.lastTextBackAt && i.now.getTime() - i.lastTextBackAt.getTime() < cfg.dedupeHours * 3_600_000)
    return { action: "skip", reason: "RECENTLY_TEXTED", createCallback: false };

  const lang: Lang = i.callerLanguage ?? i.salon.settings.defaultLanguage;
  const upcoming =
    i.upcoming && i.upcoming.startsAt > i.now && i.upcoming.startsAt.getTime() - i.now.getTime() < cfg.upcomingWindowDays * 86_400_000
      ? i.upcoming
      : undefined;
  const template: TextBackTemplate = upcoming ? "missed_call_upcoming" : "missed_call_text_back";
  const body = textBackBody({ salonName: i.salon.name, timezone: i.salon.timezone, lang, link: i.bookingUrl, upcoming });

  const sendAt = quietHoursEnd(i.now, i.salon.timezone, i.salon.settings.quietHours);
  return sendAt ? { action: "schedule", template, lang, body, sendAt } : { action: "send", template, lang, body };
}

/** If `now` is inside quiet hours, returns when they end (local), else null. Handles windows that wrap midnight. */
export function quietHoursEnd(now: Date, tz: string, q: { start: string; end: string }): Date | null {
  const m = localMinutesOf(now, tz);
  const s = hhmmToMinutes(q.start);
  const e = hhmmToMinutes(q.end);
  const inside = s === e ? false : s < e ? m >= s && m < e : m >= s || m < e;
  if (!inside) return null;
  const today = localDateOf(now, tz);
  const endDate = s > e && m >= s ? addDays(today, 1) : today; // after start, before midnight → ends tomorrow
  return localToUtc(endDate, e, tz);
}

export function textBackBody(o: {
  salonName: string;
  timezone: string;
  lang: Lang;
  link: string;
  upcoming?: { startsAt: Date; staffName?: string };
}): string {
  const short = o.salonName.split(/\s+(?:Barber|Salon|&)/)[0]; // "Tcutz Barber & Salon" → "Tcutz" keeps texts to 1–2 segments
  if (o.upcoming) {
    const when = new Intl.DateTimeFormat(o.lang === "vi" ? "vi-VN" : "en-US", {
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
      timeZone: o.timezone,
    }).format(o.upcoming.startsAt);
    return o.lang === "vi"
      ? `${short}: Xin lỗi đã lỡ cuộc gọi! Lịch hẹn của anh/chị vẫn là ${when}. Nhắn GOI để tiệm gọi lại.`
      : `${short}: Sorry we missed your call! You're still booked for ${when}. Reply CALL for a call back.`;
  }
  return o.lang === "vi"
    ? `${short}: Xin lỗi đã lỡ cuộc gọi! Đặt lịch tại ${o.link} hoặc nhắn GOI để tiệm gọi lại.`
    : `${short}: Sorry we missed your call! Book here: ${o.link} or reply CALL for a call back. Reply STOP to opt out.`;
}

// ---------------- inbound SMS keywords ----------------
export type InboundIntent = "opt_out" | "opt_in" | "help" | "callback" | "message";

/** Carrier-standard keywords + Vietnamese "GỌI" (with or without diacritics). */
export function classifyInbound(body: string): InboundIntent {
  const k = body.trim().toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/Đ/g, "D").replace(/[.!]+$/, "");
  if (["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "REVOKE", "OPTOUT", "DUNG", "NGUNG"].includes(k)) return "opt_out";
  if (["START", "UNSTOP", "YES"].includes(k)) return "opt_in";
  if (["HELP", "INFO"].includes(k)) return "help";
  if (["CALL", "CALL ME", "GOI", "GOI LAI", "CALLBACK"].includes(k)) return "callback";
  return "message";
}
