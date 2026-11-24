import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { getStaffContext } from "@/lib/auth";
import { loadRange, todayLocal } from "@/lib/dashboard";
import { addDays, hhmmToMinutes, isValidDateString, localDateOf, localMinutesOf, minutesToHhmm, weekdayOf, formatLocalTime } from "@/lib/scheduling/time";
import { STATUS_STYLE } from "@/components/ui/primitives";
import { NowLine } from "@/components/app/now-line";
import { cn } from "@/lib/utils";
import { formatDateLong } from "@/lib/i18n/dict";

export const metadata = { title: "Calendar" };
const PPM = 1.6; // pixels per minute

export default async function CalendarPage(props: PageProps<"/app/calendar">) {
  const ctx = await getStaffContext();
  const sp = await props.searchParams;
  const tz = ctx.salon.timezone;
  const today = todayLocal(ctx);
  const date = typeof sp.date === "string" && isValidDateString(sp.date) ? sp.date : today;
  const view = sp.view === "week" ? "week" : sp.view === "month" ? "month" : "day";

  const allHours = Object.values(ctx.salon.settings.businessHours).flat();
  const dayStart = Math.min(...allHours.map((h) => hhmmToMinutes(h!.open)), 9 * 60);
  const dayEnd = Math.max(...allHours.map((h) => hhmmToMinutes(h!.close)), 18 * 60);

  const weekStart = addDays(date, -weekdayOf(date)); // Sunday
  const monthStart = `${date.slice(0, 7)}-01`;
  const span = view === "day" ? 1 : view === "week" ? 7 : 42;
  const rangeStart = view === "day" ? date : view === "week" ? weekStart : addDays(monthStart, -weekdayOf(monthStart));
  const { appointments, staff } = await loadRange(ctx, rangeStart, span);
  const step = view === "day" ? 1 : view === "week" ? 7 : 30;
  const href = (d: string, v = view) => `/app/calendar?view=${v}&date=${d}`;
  const isBusy = (s: string) => !["canceled", "no_show"].includes(s);

  return (
    <div>
      <header className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Link href={href(addDays(date, -step))} className="flex size-12 items-center justify-center rounded-xl border-2 border-ink-900/10 bg-white" aria-label="Previous">
            <ChevronLeft />
          </Link>
          <Link href={href(today)} className="flex h-12 items-center rounded-xl border-2 border-ink-900/10 bg-white px-4 font-semibold">Today</Link>
          <Link href={href(addDays(date, step))} className="flex size-12 items-center justify-center rounded-xl border-2 border-ink-900/10 bg-white" aria-label="Next">
            <ChevronRight />
          </Link>
          <h1 className="ml-2 font-display text-2xl">
            {view === "month"
              ? new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${monthStart}T12:00:00Z`))
              : view === "week"
                ? `Week of ${formatDateLong(weekStart, "en")}`
                : formatDateLong(date, "en")}
          </h1>
        </div>
        <div className="flex rounded-xl border-2 border-ink-900/10 bg-white p-1" role="tablist">
          {(["day", "week", "month"] as const).map((v) => (
            <Link key={v} href={href(date, v)} role="tab" aria-selected={view === v} className={cn("flex h-10 items-center rounded-lg px-4 font-semibold capitalize", view === v ? "bg-ink-900 text-cream-50" : "text-ink-600")}>
              {v}
            </Link>
          ))}
        </div>
      </header>

      {view === "day" && (
        <div className="overflow-x-auto rounded-2xl border border-ink-900/8 bg-white">
          <div className="grid min-w-[560px]" style={{ gridTemplateColumns: `64px repeat(${staff.length}, minmax(200px, 1fr))` }}>
            <div className="border-b border-ink-900/8" />
            {staff.map((s) => (
              <div key={s.id} className="flex items-center gap-2 border-b border-l border-ink-900/8 px-3 py-3 font-semibold">
                <span className="size-3 rounded-full" style={{ background: s.color }} /> {s.displayName}
              </div>
            ))}
            <div className="relative" style={{ height: (dayEnd - dayStart) * PPM }}>
              {Array.from({ length: Math.ceil((dayEnd - dayStart) / 60) }, (_, i) => (
                <span key={i} className="absolute right-2 -translate-y-2 text-xs text-ink-400 tabular-nums" style={{ top: i * 60 * PPM }}>
                  {formatHour(dayStart + i * 60)}
                </span>
              ))}
            </div>
            {staff.map((s) => {
              const hours = s.workingHours[weekdayOf(date)] ?? [];
              return (
                <div key={s.id} className="relative border-l border-ink-900/8 bg-ink-900/[0.03]" style={{ height: (dayEnd - dayStart) * PPM }}>
                  {hours.map((h) => (
                    <div key={h.open} className="absolute inset-x-0 bg-white" style={{ top: (hhmmToMinutes(h.open) - dayStart) * PPM, height: (hhmmToMinutes(h.close) - hhmmToMinutes(h.open)) * PPM }} />
                  ))}
                  {Array.from({ length: Math.ceil((dayEnd - dayStart) / 30) }, (_, i) => (
                    <div key={i} className={cn("absolute inset-x-0 border-t", i % 2 ? "border-ink-900/4" : "border-ink-900/8")} style={{ top: i * 30 * PPM }} />
                  ))}
                  <NowLine timezone={tz} dayStartMin={dayStart} dayEndMin={dayEnd} pxPerMin={PPM} date={date} />
                  {appointments
                    .filter((e) => e.appt.staffId === s.id && localDateOf(e.appt.startsAt, tz) === date)
                    .map((e) => {
                      const top = (localMinutesOf(e.appt.startsAt, tz) - dayStart) * PPM;
                      const h = Math.max(28, ((new Date(e.appt.endsAt).getTime() - new Date(e.appt.startsAt).getTime()) / 60000) * PPM - 3);
                      const st = STATUS_STYLE[e.appt.status];
                      return (
                        <Link
                          key={e.appt.id}
                          href={`/app/appointments/${e.appt.id}`}
                          className={cn("absolute inset-x-1.5 z-10 overflow-hidden rounded-lg border-l-4 px-2 py-1 text-sm shadow-sm", st.cls, !isBusy(e.appt.status) && "opacity-50")}
                          style={{ top, height: h, borderLeftColor: s.color }}
                        >
                          <p className="truncate font-semibold">{e.customer?.firstName ?? "Walk-in"} · {formatLocalTime(e.appt.startsAt, tz)}</p>
                          <p className="truncate text-xs opacity-80">{e.appt.services.map((x) => x.name).join(" + ")} · {st.label}</p>
                        </Link>
                      );
                    })}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {view === "week" && (
        <div className="-mx-4 overflow-x-auto px-4">
          <div className="grid min-w-[840px] grid-cols-7 gap-2">
            {Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)).map((d) => {
              const list = appointments.filter((e) => localDateOf(e.appt.startsAt, tz) === d && isBusy(e.appt.status));
              return (
                <div key={d} className={cn("min-h-60 rounded-2xl border bg-white p-2", d === today ? "border-gold-500" : "border-ink-900/8")}>
                  <Link href={href(d, "day")} className="mb-2 block rounded-lg px-2 py-1 hover:bg-cream-100">
                    <span className="block text-xs font-semibold text-ink-400 uppercase">{new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`))}</span>
                    <span className="text-xl font-bold">{Number(d.slice(8))}</span>
                    <span className="ml-1 text-sm text-ink-400">{list.length ? `${list.length} appt` : ""}</span>
                  </Link>
                  <div className="space-y-1.5">
                    {list.map((e) => (
                      <Link key={e.appt.id} href={`/app/appointments/${e.appt.id}`} className={cn("block rounded-lg border-l-4 px-2 py-1.5 text-xs", STATUS_STYLE[e.appt.status].cls)} style={{ borderLeftColor: e.staff?.color }}>
                        <span className="font-bold tabular-nums">{formatLocalTime(e.appt.startsAt, tz)}</span> {e.customer?.firstName ?? "Walk-in"}
                        <span className="block truncate opacity-75">{e.appt.services[0]?.name}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {view === "month" && (
        <div className="grid grid-cols-7 gap-1.5">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <p key={d} className="px-1 text-xs font-semibold text-ink-400 uppercase">{d}</p>
          ))}
          {Array.from({ length: 42 }, (_, i) => addDays(rangeStart, i)).map((d) => {
            const n = appointments.filter((e) => localDateOf(e.appt.startsAt, tz) === d && isBusy(e.appt.status)).length;
            const inMonth = d.slice(0, 7) === monthStart.slice(0, 7);
            return (
              <Link key={d} href={href(d, "day")} className={cn("flex aspect-square flex-col rounded-xl border bg-white p-2 sm:aspect-[4/3]", d === today ? "border-gold-500" : "border-ink-900/8", !inMonth && "opacity-40")}>
                <span className="text-sm font-semibold">{Number(d.slice(8))}</span>
                {n > 0 && <span className="mt-auto self-start rounded-full bg-gold-500 px-2 py-0.5 text-xs font-bold text-ink-950">{n}</span>}
              </Link>
            );
          })}
        </div>
      )}
      <p className="mt-4 text-sm text-ink-400">Tap an appointment to reschedule or change it. Drag-and-drop rescheduling is planned (see status doc).</p>
    </div>
  );
}

function formatHour(mins: number) {
  const [h] = minutesToHhmm(mins).split(":").map(Number);
  return `${((h + 11) % 12) + 1} ${h < 12 ? "AM" : "PM"}`;
}
