import { fromZonedTime, formatInTimeZone } from "date-fns-tz";

/** Minutes since local midnight for "HH:mm". */
export function hhmmToMinutes(hhmm: string): number {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) throw new Error(`Invalid time: ${hhmm}`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59) throw new Error(`Invalid time: ${hhmm}`);
  return h * 60 + min;
}

export function minutesToHhmm(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Converts a local wall-clock date+time in `tz` to a UTC Date (DST-aware). */
export function localToUtc(date: string, minutesOfDay: number, tz: string): Date {
  return fromZonedTime(`${date}T${minutesToHhmm(minutesOfDay)}:00`, tz);
}

/** Local calendar date (YYYY-MM-DD) of a UTC instant in `tz`. */
export function localDateOf(d: Date | string, tz: string): string {
  return formatInTimeZone(new Date(d), tz, "yyyy-MM-dd");
}

/** Minutes since local midnight of a UTC instant in `tz`. */
export function localMinutesOf(d: Date | string, tz: string): number {
  return hhmmToMinutes(formatInTimeZone(new Date(d), tz, "HH:mm"));
}

/** 0 = Sunday. Pure calendar arithmetic on a YYYY-MM-DD string (timezone independent). */
export function weekdayOf(date: string): 0 | 1 | 2 | 3 | 4 | 5 | 6 {
  return new Date(`${date}T12:00:00Z`).getUTCDay() as 0 | 1 | 2 | 3 | 4 | 5 | 6;
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** UTC bounds [start, end) of a local calendar day — 23 or 25 hours long on DST days. */
export function localDayBounds(date: string, tz: string): { start: Date; end: Date } {
  return { start: localToUtc(date, 0, tz), end: localToUtc(addDays(date, 1), 0, tz) };
}

export function addMinutes(d: Date, mins: number): Date {
  return new Date(d.getTime() + mins * 60_000);
}

export function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export function formatLocalTime(d: Date | string, tz: string, lang: "en" | "vi" = "en"): string {
  return lang === "vi"
    ? formatInTimeZone(new Date(d), tz, "H:mm")
    : formatInTimeZone(new Date(d), tz, "h:mm a");
}

export function isValidDateString(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
