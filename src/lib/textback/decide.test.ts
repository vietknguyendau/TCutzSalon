import { describe, expect, it } from "vitest";
import { classifyInbound, decideTextBack, quietHoursEnd, textBackBody, type DecisionInput } from "./decide";
import { demoSalon } from "../data/fixtures";
import { countSegments } from "../providers/segments";

const TZ = "America/Chicago";
const at = (iso: string) => new Date(iso);
const base = (o: Partial<DecisionInput> = {}): DecisionInput => ({
  salon: demoSalon,
  bookingUrl: "https://book.example-salon.com/?r=m",
  from: "+17635550177",
  outcome: "missed",
  now: at("2026-12-07T19:00:00Z"), // Mon 1:00 PM CST
  lineType: "mobile",
  optedOut: false,
  lastTextBackAt: null,
  ...o,
});

describe("decideTextBack", () => {
  it("texts a new mobile caller right away with the booking link", () => {
    const d = decideTextBack(base());
    expect(d.action).toBe("send");
    if (d.action === "send") {
      expect(d.body).toContain("https://book.example-salon.com/?r=m");
      expect(d.body).toContain("STOP");
      expect(d.template).toBe("missed_call_text_back");
    }
  });

  it("never texts when the AI already booked them or the call was transferred", () => {
    expect(decideTextBack(base({ outcome: "booked" }))).toMatchObject({ action: "skip", reason: "NOT_A_MISSED_CALL" });
    expect(decideTextBack(base({ outcome: "transferred" }))).toMatchObject({ action: "skip", reason: "NOT_A_MISSED_CALL" });
  });

  it("texts callers who asked a question but didn't book (AI 'info' outcome)", () => {
    expect(decideTextBack(base({ outcome: "info" })).action).toBe("send");
  });

  it("STOP always wins", () => {
    expect(decideTextBack(base({ optedOut: true }))).toMatchObject({ action: "skip", reason: "OPTED_OUT" });
  });

  it("landlines go on the call-back list instead", () => {
    expect(decideTextBack(base({ lineType: "landline" }))).toEqual({ action: "skip", reason: "LANDLINE", createCallback: true });
  });

  it("blocked / anonymous caller ID is skipped", () => {
    expect(decideTextBack(base({ from: null })).action).toBe("skip");
    expect(decideTextBack(base({ from: "+266696687" })).action).toBe("skip"); // Twilio 'Anonymous'
  });

  it("only one text per number within 12 hours", () => {
    const now = at("2026-12-07T19:00:00Z");
    expect(decideTextBack(base({ now, lastTextBackAt: new Date(now.getTime() - 3 * 3_600_000) }))).toMatchObject({ reason: "RECENTLY_TEXTED" });
    expect(decideTextBack(base({ now, lastTextBackAt: new Date(now.getTime() - 13 * 3_600_000) })).action).toBe("send");
  });

  it("existing appointment → reminder instead of a booking link", () => {
    const d = decideTextBack(base({ upcoming: { startsAt: at("2026-12-10T21:30:00Z") } }));
    expect(d.action).toBe("send");
    if (d.action === "send") {
      expect(d.template).toBe("missed_call_upcoming");
      expect(d.body).toContain("Thu 3:30 PM");
      expect(d.body).not.toContain("http");
    }
  });

  it("uses Vietnamese when the caller chose it", () => {
    const d = decideTextBack(base({ callerLanguage: "vi" }));
    expect(d.action === "send" && d.body).toContain("Xin lỗi đã lỡ cuộc gọi");
  });

  it("holds texts during quiet hours until 9:00 AM", () => {
    const d = decideTextBack(base({ now: at("2026-12-08T03:45:00Z") })); // Mon 9:45 PM CST
    expect(d.action).toBe("schedule");
    if (d.action === "schedule") expect(d.sendAt.toISOString()).toBe("2026-12-08T15:00:00.000Z"); // Tue 9:00 CST
  });

  it("can be switched off per salon", () => {
    const salon = { ...demoSalon, settings: { ...demoSalon.settings, missedCallTextBack: { enabled: false, dedupeHours: 12, upcomingWindowDays: 14 } } };
    expect(decideTextBack(base({ salon }))).toMatchObject({ reason: "DISABLED" });
  });
});

describe("quietHoursEnd", () => {
  const q = { start: "20:00", end: "09:00" };
  it("after midnight ends the same morning", () => {
    expect(quietHoursEnd(at("2026-12-08T08:00:00Z"), TZ, q)?.toISOString()).toBe("2026-12-08T15:00:00.000Z"); // 2 AM → 9 AM
  });
  it("outside quiet hours → null", () => {
    expect(quietHoursEnd(at("2026-12-08T16:00:00Z"), TZ, q)).toBeNull(); // 10 AM
  });
  it("is DST-aware (morning after spring-forward is CDT)", () => {
    expect(quietHoursEnd(at("2027-03-14T03:00:00Z"), TZ, q)?.toISOString()).toBe("2027-03-14T14:00:00.000Z"); // Sat 9 PM CST → Sun 9 AM CDT
  });
});

describe("message length / cost", () => {
  it("English booking-link text fits in one SMS segment", () => {
    const b = textBackBody({ salonName: "Main Street Barber & Salon", timezone: TZ, lang: "en", link: "https://book.example-salon.com/?r=m" });
    expect(b.length).toBeLessThanOrEqual(160);
    expect(countSegments(b)).toBe(1);
  });
  it("Vietnamese text stays within 2 segments (UCS-2)", () => {
    const b = textBackBody({ salonName: "Main Street Barber & Salon", timezone: TZ, lang: "vi", link: "https://book.example-salon.com/?r=m&lang=vi" });
    expect(countSegments(b)).toBeLessThanOrEqual(2);
  });
});

describe("classifyInbound", () => {
  it.each([
    ["STOP", "opt_out"],
    ["stop.", "opt_out"],
    ["Unsubscribe", "opt_out"],
    ["START", "opt_in"],
    ["HELP", "help"],
    ["call", "callback"],
    ["GỌI", "callback"],
    ["goi lai", "callback"],
    ["Can I come at 3 today?", "message"],
  ])("%s → %s", (msg, intent) => expect(classifyInbound(msg)).toBe(intent));
});
