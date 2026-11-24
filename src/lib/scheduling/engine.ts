// Pure availability engine. No I/O: callers load the context, the engine decides.
// The database remains the final authority (exclusion constraint + book_appointment()).

import type { Salon, Service, Staff, TimeRange } from "../domain/types";
import {
  addMinutes,
  hhmmToMinutes,
  localDateOf,
  localMinutesOf,
  localToUtc,
  overlaps,
  weekdayOf,
} from "./time";

export interface BusyBlock {
  staffId: string;
  start: Date;
  end: Date;
  kind: "appointment" | "hold" | "time_off";
}

export interface SchedulingContext {
  salon: Pick<Salon, "timezone" | "settings">;
  staff: Staff[];
  busy: BusyBlock[];
  now: Date;
}

export type Channel = "website" | "ai_phone" | "manual" | "walk_in" | "rebooking";

export interface SlotRequest {
  service: Service;
  extraMinutes?: number;
  staffId: string; // a specific staff member
  start: Date;
  channel: Channel;
  /** Appointment being rescheduled — its own block is ignored. */
  ignoreAppointmentStart?: Date;
}

export type SlotRejection =
  | "STAFF_NOT_FOUND"
  | "STAFF_NOT_QUALIFIED"
  | "SERVICE_NOT_BOOKABLE"
  | "SALON_CLOSED"
  | "OUTSIDE_STAFF_HOURS"
  | "TOO_SOON"
  | "TOO_FAR_AHEAD"
  | "CONFLICT";

export interface SlotCheck {
  ok: boolean;
  reason?: SlotRejection;
  durationMinutes: number;
  end: Date; // end of service
  blockedUntil: Date; // end incl. cleanup
}

/** Self-service channels must obey hours, notice and advance rules. Staff can override hours. */
function isSelfService(channel: Channel): boolean {
  return channel === "website" || channel === "ai_phone" || channel === "rebooking";
}

export function serviceDurationFor(staff: Staff, service: Service, extraMinutes = 0): number | null {
  const link = staff.services.find((s) => s.serviceId === service.id);
  if (!link) return null;
  return (link.durationOverrideMinutes ?? service.durationMinutes) + extraMinutes;
}

function intersect(a: TimeRange[], b: TimeRange[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const x of a) {
    for (const y of b) {
      const s = Math.max(hhmmToMinutes(x.open), hhmmToMinutes(y.open));
      const e = Math.min(hhmmToMinutes(x.close), hhmmToMinutes(y.close));
      if (e > s) out.push([s, e]);
    }
  }
  return out.sort((p, q) => p[0] - q[0]);
}

/** Working windows (local minutes-of-day) when the staff member AND the salon are open. */
export function workingWindows(ctx: SchedulingContext, staff: Staff, date: string): Array<[number, number]> {
  const { settings } = ctx.salon;
  if (settings.closedDates.includes(date)) return [];
  const wd = weekdayOf(date);
  return intersect(settings.businessHours[wd] ?? [], staff.workingHours[wd] ?? []);
}

export function checkSlot(ctx: SchedulingContext, req: SlotRequest): SlotCheck {
  const { salon, now } = ctx;
  const tz = salon.timezone;
  const staff = ctx.staff.find((s) => s.id === req.staffId && s.isActive);
  const fail = (reason: SlotRejection, duration = 0): SlotCheck => ({
    ok: false,
    reason,
    durationMinutes: duration,
    end: addMinutes(req.start, duration),
    blockedUntil: addMinutes(req.start, duration + req.service.cleanupMinutes),
  });
  if (!staff) return fail("STAFF_NOT_FOUND");

  const duration = serviceDurationFor(staff, req.service, req.extraMinutes);
  if (duration === null) return fail("STAFF_NOT_QUALIFIED");
  const end = addMinutes(req.start, duration);
  const blockedUntil = addMinutes(end, req.service.cleanupMinutes);

  const self = isSelfService(req.channel);
  if (!req.service.isActive) return fail("SERVICE_NOT_BOOKABLE", duration);
  if (req.channel === "website" && (!req.service.onlineBookable || !staff.isBookableOnline))
    return fail("SERVICE_NOT_BOOKABLE", duration);
  if (req.channel === "ai_phone" && !req.service.aiBookable) return fail("SERVICE_NOT_BOOKABLE", duration);

  if (self) {
    const minStart = addMinutes(now, salon.settings.minBookingNoticeMinutes);
    if (req.start < minStart) return fail("TOO_SOON", duration);
    const maxStart = addMinutes(now, salon.settings.maxAdvanceDays * 24 * 60);
    if (req.start > maxStart) return fail("TOO_FAR_AHEAD", duration);

    const date = localDateOf(req.start, tz);
    if (localDateOf(end, tz) !== date) return fail("OUTSIDE_STAFF_HOURS", duration);
    const startMin = localMinutesOf(req.start, tz);
    const endMin = startMin + duration;
    const windows = workingWindows(ctx, staff, date);
    if (windows.length === 0) return fail("SALON_CLOSED", duration);
    // A service must START and END inside an open window. Cleanup may run past closing.
    if (!windows.some(([s, e]) => startMin >= s && endMin <= e)) return fail("OUTSIDE_STAFF_HOURS", duration);
  }

  const conflict = ctx.busy.some(
    (b) =>
      b.staffId === staff.id &&
      !(req.ignoreAppointmentStart && b.kind === "appointment" && b.start.getTime() === req.ignoreAppointmentStart.getTime()) &&
      overlaps(req.start, blockedUntil, b.start, b.end),
  );
  if (conflict) return fail("CONFLICT", duration);

  return { ok: true, durationMinutes: duration, end, blockedUntil };
}

export interface AvailableSlot {
  start: string; // ISO UTC
  end: string;
  staffIds: string[]; // in preference order
}

export interface AvailabilityQuery {
  date: string; // local YYYY-MM-DD
  service: Service;
  extraMinutes?: number;
  staffId?: string; // undefined = first available
  channel: Channel;
}

/** All bookable start times for one local day, grouped by start time with the staff who can take it. */
export function getAvailability(ctx: SchedulingContext, q: AvailabilityQuery): AvailableSlot[] {
  const tz = ctx.salon.timezone;
  const interval = ctx.salon.settings.slotIntervalMinutes;
  const candidates = ctx.staff
    .filter((s) => s.isActive && (!q.staffId || s.id === q.staffId))
    .filter((s) => q.channel !== "website" || s.isBookableOnline)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const byStart = new Map<number, AvailableSlot>();
  for (const staff of candidates) {
    const duration = serviceDurationFor(staff, q.service, q.extraMinutes);
    if (duration === null) continue;
    for (const [winStart, winEnd] of workingWindows(ctx, staff, q.date)) {
      const first = Math.ceil(winStart / interval) * interval;
      for (let m = first; m + duration <= winEnd; m += interval) {
        const start = localToUtc(q.date, m, tz);
        // Skip wall-clock times that do not exist (DST spring-forward gap) — they map to another minute.
        if (localMinutesOf(start, tz) !== m) continue;
        const res = checkSlot(ctx, { service: q.service, extraMinutes: q.extraMinutes, staffId: staff.id, start, channel: q.channel });
        if (!res.ok) continue;
        const key = start.getTime();
        const slot = byStart.get(key);
        if (slot) slot.staffIds.push(staff.id);
        else byStart.set(key, { start: start.toISOString(), end: res.end.toISOString(), staffIds: [staff.id] });
      }
    }
  }
  return [...byStart.values()].sort((a, b) => a.start.localeCompare(b.start));
}

/** Nearest available slots to a requested time — what the AI receptionist offers ("3:00 is booked, 3:30 is open"). */
export function nearestSlots(slots: AvailableSlot[], target: Date, count = 2): AvailableSlot[] {
  return [...slots]
    .sort((a, b) => Math.abs(new Date(a.start).getTime() - target.getTime()) - Math.abs(new Date(b.start).getTime() - target.getTime()))
    .slice(0, count)
    .sort((a, b) => a.start.localeCompare(b.start));
}
