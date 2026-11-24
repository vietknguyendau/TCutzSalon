import { describe, expect, it } from "vitest";
import { checkSlot, getAvailability, nearestSlots, type BusyBlock, type SchedulingContext } from "./engine";
import { localToUtc, localDayBounds, formatLocalTime } from "./time";
import { tcutzSalon, tcutzServices, tcutzStaff, STAFF_DIEM, STAFF_SAMPLE, SVC_ID } from "../data/fixtures";

const TZ = "America/Chicago";
const svc = (id: string) => tcutzServices.find((s) => s.id === id)!;
const MONDAY = "2026-12-07"; // Diem works, Sample Stylist does not
const TUESDAY = "2026-12-08"; // both work

function ctx(overrides: Partial<SchedulingContext> = {}): SchedulingContext {
  return {
    salon: tcutzSalon,
    staff: tcutzStaff,
    busy: [],
    now: new Date("2026-12-01T12:00:00Z"),
    ...overrides,
  };
}
const at = (date: string, hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return localToUtc(date, h * 60 + m, TZ);
};
const appt = (staffId: string, date: string, start: string, end: string): BusyBlock => ({
  staffId,
  start: at(date, start),
  end: at(date, end),
  kind: "appointment",
});

describe("getAvailability", () => {
  it("lists every 15-min start for a 30-min cut within 10:00–19:00", () => {
    const slots = getAvailability(ctx(), { date: MONDAY, service: svc(SVC_ID.mens), channel: "website" });
    expect(slots).toHaveLength(35); // (540 - 30) / 15 + 1
    expect(formatLocalTime(slots[0].start, TZ)).toBe("10:00 AM");
    expect(formatLocalTime(slots.at(-1)!.start, TZ)).toBe("6:30 PM");
    expect(slots.every((s) => s.staffIds.join() === STAFF_DIEM)).toBe(true);
  });

  it("uses Sunday hours (12:00–17:00)", () => {
    const slots = getAvailability(ctx(), { date: "2026-12-06", service: svc(SVC_ID.mens), channel: "website" });
    expect(formatLocalTime(slots[0].start, TZ)).toBe("12:00 PM");
    expect(formatLocalTime(slots.at(-1)!.start, TZ)).toBe("4:30 PM");
  });

  it("removes times that overlap an existing appointment (the '3:00 is booked, 3:30 is open' case)", () => {
    const busy = [appt(STAFF_DIEM, MONDAY, "15:00", "15:30")];
    const slots = getAvailability(ctx({ busy }), { date: MONDAY, service: svc(SVC_ID.mens), staffId: STAFF_DIEM, channel: "ai_phone" });
    const times = slots.map((s) => formatLocalTime(s.start, TZ));
    expect(times).not.toContain("3:00 PM");
    expect(times).not.toContain("2:45 PM"); // would run into 3:00
    expect(times).toContain("2:30 PM");
    expect(times).toContain("3:30 PM");
    const near = nearestSlots(slots, at(MONDAY, "15:00"), 2).map((s) => formatLocalTime(s.start, TZ));
    expect(near).toEqual(["2:30 PM", "3:30 PM"]);
  });

  it("first available falls back to another qualified stylist", () => {
    const busy = [appt(STAFF_DIEM, TUESDAY, "10:00", "12:00")];
    const slots = getAvailability(ctx({ busy }), { date: TUESDAY, service: svc(SVC_ID.mens), channel: "website" });
    expect(slots[0].start).toBe(at(TUESDAY, "10:00").toISOString());
    expect(slots[0].staffIds).toEqual([STAFF_SAMPLE]);
  });

  it("only offers services a stylist is qualified for", () => {
    const slots = getAvailability(ctx(), { date: TUESDAY, service: svc(SVC_ID.color), staffId: STAFF_SAMPLE, channel: "website" });
    expect(slots).toHaveLength(0);
  });

  it("applies staff-specific duration overrides", () => {
    const slots = getAvailability(ctx(), { date: TUESDAY, service: svc(SVC_ID.womens), staffId: STAFF_SAMPLE, channel: "website" });
    // Sample Stylist: 60 min women's cut, works until 18:00 → last start 17:00
    expect(formatLocalTime(slots.at(-1)!.start, TZ)).toBe("5:00 PM");
    expect(new Date(slots[0].end).getTime() - new Date(slots[0].start).getTime()).toBe(60 * 60_000);
  });

  it("cleanup buffers block the following slot", () => {
    // Color 13:00–15:00 + 10 min cleanup → staff free at 15:10 → next 15-min slot is 15:15
    const color = svc(SVC_ID.color);
    const busy: BusyBlock[] = [{ staffId: STAFF_DIEM, start: at(MONDAY, "13:00"), end: at(MONDAY, "15:10"), kind: "appointment" }];
    const times = getAvailability(ctx({ busy }), { date: MONDAY, service: svc(SVC_ID.mens), channel: "website" }).map((s) =>
      formatLocalTime(s.start, TZ),
    );
    expect(times).not.toContain("3:00 PM");
    expect(times).toContain("3:15 PM");
    // And a new color booking leaves its own cleanup: color at 16:45 would end 18:45 (+10 cleanup past close is allowed)
    const colorTimes = getAvailability(ctx(), { date: MONDAY, service: color, channel: "website" }).map((s) => formatLocalTime(s.start, TZ));
    expect(colorTimes.at(-1)).toBe("5:00 PM");
  });

  it("respects staff time off (lunch, vacation)", () => {
    const busy: BusyBlock[] = [{ staffId: STAFF_DIEM, start: at(MONDAY, "12:00"), end: at(MONDAY, "13:00"), kind: "time_off" }];
    const times = getAvailability(ctx({ busy }), { date: MONDAY, service: svc(SVC_ID.mens), channel: "website" }).map((s) =>
      formatLocalTime(s.start, TZ),
    );
    expect(times).not.toContain("12:00 PM");
    expect(times).not.toContain("11:45 AM");
    expect(times).toContain("11:30 AM");
    expect(times).toContain("1:00 PM");
  });

  it("enforces minimum booking notice", () => {
    const now = at(MONDAY, "13:10");
    const times = getAvailability(ctx({ now }), { date: MONDAY, service: svc(SVC_ID.mens), channel: "website" }).map((s) =>
      formatLocalTime(s.start, TZ),
    );
    expect(times[0]).toBe("2:15 PM"); // 13:10 + 60 min notice → 14:10 → next slot 14:15
  });

  it("enforces the maximum advance window", () => {
    const slots = getAvailability(ctx(), { date: "2027-03-01", service: svc(SVC_ID.mens), channel: "website" });
    expect(slots).toHaveLength(0);
  });

  it("returns nothing on closed dates (holidays)", () => {
    const salon = { ...tcutzSalon, settings: { ...tcutzSalon.settings, closedDates: [MONDAY] } };
    expect(getAvailability(ctx({ salon }), { date: MONDAY, service: svc(SVC_ID.mens), channel: "website" })).toHaveLength(0);
  });
});

describe("daylight saving time (America/Chicago)", () => {
  it("fall back: 2026-11-01 is a 25-hour day and noon is UTC-6", () => {
    const { start, end } = localDayBounds("2026-11-01", TZ);
    expect((end.getTime() - start.getTime()) / 3_600_000).toBe(25);
    const slots = getAvailability(ctx({ now: new Date("2026-10-25T12:00:00Z") }), {
      date: "2026-11-01",
      service: svc(SVC_ID.mens),
      channel: "website",
    });
    expect(slots[0].start).toBe("2026-11-01T18:00:00.000Z"); // 12:00 CST
  });

  it("the day before fall back is still UTC-5", () => {
    const slots = getAvailability(ctx({ now: new Date("2026-10-25T12:00:00Z") }), {
      date: "2026-10-31",
      service: svc(SVC_ID.mens),
      channel: "website",
    });
    expect(slots[0].start).toBe("2026-10-31T15:00:00.000Z"); // 10:00 CDT
  });

  it("spring forward: 2027-03-14 is a 23-hour day and noon is UTC-5", () => {
    const { start, end } = localDayBounds("2027-03-14", TZ);
    expect((end.getTime() - start.getTime()) / 3_600_000).toBe(23);
    const slots = getAvailability(ctx({ now: new Date("2027-03-01T12:00:00Z") }), {
      date: "2027-03-14",
      service: svc(SVC_ID.mens),
      channel: "website",
    });
    expect(slots[0].start).toBe("2027-03-14T17:00:00.000Z");
    expect(slots).toHaveLength(19); // 12:00–17:00, 30-min service, 15-min steps
  });
});

describe("checkSlot", () => {
  it("lets staff book a walk-in outside online hours but never over a conflict", () => {
    const early = at(MONDAY, "09:30");
    expect(checkSlot(ctx(), { service: svc(SVC_ID.mens), staffId: STAFF_DIEM, start: early, channel: "website" }).reason).toBe(
      "OUTSIDE_STAFF_HOURS",
    );
    expect(checkSlot(ctx(), { service: svc(SVC_ID.mens), staffId: STAFF_DIEM, start: early, channel: "walk_in" }).ok).toBe(true);
    const busy = [appt(STAFF_DIEM, MONDAY, "09:45", "10:15")];
    expect(checkSlot(ctx({ busy }), { service: svc(SVC_ID.mens), staffId: STAFF_DIEM, start: early, channel: "walk_in" }).reason).toBe(
      "CONFLICT",
    );
  });

  it("ignores the appointment being rescheduled", () => {
    const start = at(MONDAY, "11:00");
    const busy = [appt(STAFF_DIEM, MONDAY, "11:00", "11:30")];
    const res = checkSlot(ctx({ busy }), {
      service: svc(SVC_ID.mens),
      staffId: STAFF_DIEM,
      start: at(MONDAY, "11:15"),
      channel: "manual",
      ignoreAppointmentStart: start,
    });
    expect(res.ok).toBe(true);
  });

  it("rejects services not enabled for the AI receptionist", () => {
    const s = { ...svc(SVC_ID.color), aiBookable: false };
    expect(checkSlot(ctx(), { service: s, staffId: STAFF_DIEM, start: at(MONDAY, "11:00"), channel: "ai_phone" }).reason).toBe(
      "SERVICE_NOT_BOOKABLE",
    );
  });
});
