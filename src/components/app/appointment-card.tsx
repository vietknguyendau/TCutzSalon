"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Check, Loader2, MoreHorizontal, Phone, RotateCcw, Scissors, UserX, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Pill, SOURCE_LABEL, STATUS_STYLE, StatusBadge } from "@/components/ui/primitives";
import { setStatusAction } from "@/app/app/actions";
import type { AppointmentSource, AppointmentStatus } from "@/lib/domain/types";
import { cn } from "@/lib/utils";

export interface CardData {
  id: string;
  time: string;
  endTime: string;
  status: AppointmentStatus;
  source: AppointmentSource;
  customerId?: string;
  customerName: string;
  phone?: string;
  isReturning: boolean;
  visits: number;
  haircut?: string;
  services: string;
  price: string;
  staffName?: string;
  staffColor?: string;
  note?: string;
  isNow: boolean;
  next: AppointmentStatus | null;
  allowed: AppointmentStatus[];
}

const NEXT_LABEL: Partial<Record<AppointmentStatus, { label: string; icon: React.ReactNode }>> = {
  booked: { label: "Approve", icon: <Check /> },
  arrived: { label: "Arrived", icon: <Check /> },
  in_progress: { label: "Start", icon: <Scissors /> },
  completed: { label: "Done", icon: <Check /> },
};

export function AppointmentCard({ c }: { c: CardData }) {
  const [pending, start] = useTransition();
  const [menu, setMenu] = useState(false);
  const [err, setErr] = useState<string>();
  const act = (s: AppointmentStatus) =>
    start(async () => {
      setErr(undefined);
      const r = await setStatusAction(c.id, s);
      if (!r.ok) setErr(r.error);
      setMenu(false);
    });
  const faded = c.status === "canceled" || c.status === "no_show";

  return (
    <article
      className={cn(
        "relative overflow-hidden rounded-2xl border bg-white pl-4",
        c.isNow ? "border-gold-500 shadow-[0_0_0_3px_rgba(201,169,110,0.25)]" : "border-ink-900/8",
        faded && "opacity-60",
      )}
    >
      <span className={cn("absolute inset-y-0 left-0 w-1.5", STATUS_STYLE[c.status].bar)} aria-hidden />
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
        <div className="w-24 shrink-0 whitespace-nowrap">
          <p className="text-xl font-bold tabular-nums text-ink-950">{c.time}</p>
          <p className="text-sm text-ink-400 tabular-nums">{c.endTime}</p>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {c.customerId ? (
              <Link href={`/app/customers/${c.customerId}`} className="text-lg font-semibold text-ink-950 hover:underline">
                {c.customerName}
              </Link>
            ) : (
              <span className="text-lg font-semibold text-ink-950">{c.customerName}</span>
            )}
            <StatusBadge status={c.status} />
            {c.isReturning ? <Pill>{c.visits} visits</Pill> : <Pill className="bg-gold-300/60">New</Pill>}
            <Pill>{SOURCE_LABEL[c.source]}</Pill>
          </div>
          <p className="mt-0.5 text-[15px] text-ink-700">
            {c.services} · <span className="font-medium">{c.price}</span>
            {c.staffName && (
              <span className="ml-2 inline-flex items-center gap-1.5 text-ink-400">
                <span className="size-2.5 rounded-full" style={{ background: c.staffColor }} /> {c.staffName}
              </span>
            )}
          </p>
          {c.haircut && (
            <p className="mt-1.5 rounded-lg bg-cream-100 px-2.5 py-1.5 text-sm text-ink-700">
              <span className="font-semibold text-gold-700">Last time:</span> {c.haircut}
            </p>
          )}
          {c.note && <p className="mt-1 text-sm text-ink-600 italic">“{c.note}”</p>}
          {err && <p className="mt-1 text-sm text-red-700" role="alert">{err}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {c.next && NEXT_LABEL[c.next] && (
            <Button variant={c.next === "completed" ? "success" : "gold"} size="lg" className="min-w-32" disabled={pending} onClick={() => act(c.next!)}>
              {pending ? <Loader2 className="animate-spin" /> : NEXT_LABEL[c.next]!.icon} {NEXT_LABEL[c.next]!.label}
            </Button>
          )}
          <Button variant="outline" size="icon" aria-label="More actions" onClick={() => setMenu((m) => !m)}>
            <MoreHorizontal />
          </Button>
        </div>
      </div>
      {menu && (
        <div className="flex flex-wrap gap-2 border-t border-ink-900/8 bg-cream-50 p-3">
          {c.allowed.includes("no_show") && (
            <Button variant="outline" onClick={() => act("no_show")} disabled={pending}>
              <UserX /> No-show
            </Button>
          )}
          {c.allowed.includes("canceled") && (
            <Button variant="outline" className="text-red-700" onClick={() => act("canceled")} disabled={pending}>
              <X /> Cancel
            </Button>
          )}
          {c.allowed.includes("arrived") && c.status === "no_show" && (
            <Button variant="outline" onClick={() => act("arrived")} disabled={pending}>
              <RotateCcw /> Arrived late
            </Button>
          )}
          <Link href={`/app/appointments/${c.id}`} className="inline-flex h-12 items-center rounded-xl border-2 border-ink-900/15 bg-white px-4 font-semibold">
            Reschedule / details
          </Link>
          {c.phone && (
            <a href={`tel:${c.phone}`} className="inline-flex h-12 items-center gap-2 rounded-xl border-2 border-ink-900/15 bg-white px-4 font-semibold">
              <Phone className="size-5" /> Call
            </a>
          )}
        </div>
      )}
    </article>
  );
}
