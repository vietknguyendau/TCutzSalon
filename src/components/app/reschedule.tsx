"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { rescheduleAction, staffSlotsAction } from "@/app/app/actions";
import { cn } from "@/lib/utils";

function addDays(date: string, n: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function Reschedule(props: { appointmentId: string; serviceId: string; staff: { id: string; name: string; color: string }[]; staffId: string; today: string; timezone: string }) {
  const router = useRouter();
  const [staffId, setStaffId] = useState(props.staffId);
  const [date, setDate] = useState(props.today);
  const [res, setRes] = useState<{ key: string; slots: string[] }>();
  const slots = res?.key === `${staffId}|${date}` ? res.slots : null;
  const [err, setErr] = useState<string>();
  const [ok, setOk] = useState(false);
  const [pending, start] = useTransition();
  const fmt = useMemo(() => new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: props.timezone }), [props.timezone]);

  useEffect(() => {
    let live = true;
    staffSlotsAction(props.serviceId, staffId, date).then((s) => live && setRes({ key: `${staffId}|${date}`, slots: s }));
    return () => { live = false; };
  }, [props.serviceId, staffId, date]);

  const move = (startsAt: string) =>
    start(async () => {
      setErr(undefined);
      const r = await rescheduleAction(props.appointmentId, startsAt, staffId);
      if (r.ok) {
        setOk(true);
        router.refresh();
      } else setErr(r.error);
    });

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        {props.staff.map((s) => (
          <button key={s.id} onClick={() => setStaffId(s.id)} className={cn("flex h-11 items-center gap-2 rounded-xl border-2 bg-white px-3 font-semibold", s.id === staffId ? "border-gold-500" : "border-ink-900/10")}>
            <span className="size-3 rounded-full" style={{ background: s.color }} /> {s.name}
          </button>
        ))}
      </div>
      <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
        {Array.from({ length: 14 }, (_, i) => addDays(props.today, i)).map((d) => (
          <button key={d} onClick={() => setDate(d)} className={cn("h-11 shrink-0 rounded-xl border-2 px-3 text-sm font-semibold", d === date ? "border-ink-900 bg-ink-900 text-cream-50" : "border-ink-900/10 bg-white")}>
            {new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`))}
          </button>
        ))}
      </div>
      {slots === null ? (
        <p className="flex items-center gap-2 text-ink-400"><Loader2 className="size-4 animate-spin" /> Checking…</p>
      ) : slots.length === 0 ? (
        <p className="text-ink-600">No openings.</p>
      ) : (
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
          {slots.map((s) => (
            <Button key={s} variant="outline" size="md" disabled={pending} onClick={() => move(s)} className="tabular-nums">
              {fmt.format(new Date(s))}
            </Button>
          ))}
        </div>
      )}
      {err && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-red-800" role="alert">{err}</p>}
      {ok && <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-emerald-800" role="status">Moved. The calendar is updated.</p>}
    </div>
  );
}
