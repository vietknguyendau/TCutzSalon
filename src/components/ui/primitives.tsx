import * as React from "react";
import { cn } from "@/lib/utils";
import type { AppointmentSource, AppointmentStatus } from "@/lib/domain/types";

export function Card({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-2xl border border-ink-900/8 bg-white shadow-[0_1px_2px_rgba(28,27,26,0.04)]", className)} {...p} />;
}

export function Input({ className, ...p }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-12 w-full rounded-xl border-2 border-ink-900/12 bg-white px-4 text-base text-ink-900 placeholder:text-ink-400 focus:border-gold-500 focus:outline-none",
        className,
      )}
      {...p}
    />
  );
}

export function Textarea({ className, ...p }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "min-h-20 w-full rounded-xl border-2 border-ink-900/12 bg-white px-4 py-3 text-base text-ink-900 placeholder:text-ink-400 focus:border-gold-500 focus:outline-none",
        className,
      )}
      {...p}
    />
  );
}

export function Label({ className, ...p }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("mb-1.5 block text-sm font-medium text-ink-700", className)} {...p} />;
}

export const STATUS_STYLE: Record<AppointmentStatus, { label: string; cls: string; bar: string }> = {
  pending_approval: { label: "Needs approval", cls: "bg-amber-100 text-amber-900", bar: "bg-amber-500" },
  booked: { label: "Booked", cls: "bg-sky-100 text-sky-900", bar: "bg-sky-600" },
  confirmed: { label: "Confirmed", cls: "bg-teal-100 text-teal-900", bar: "bg-teal-600" },
  arrived: { label: "Arrived", cls: "bg-violet-100 text-violet-900", bar: "bg-violet-600" },
  in_progress: { label: "In chair", cls: "bg-gold-300 text-ink-950", bar: "bg-gold-500" },
  completed: { label: "Done", cls: "bg-emerald-100 text-emerald-900", bar: "bg-emerald-600" },
  canceled: { label: "Canceled", cls: "bg-ink-900/8 text-ink-600 line-through", bar: "bg-ink-300" },
  no_show: { label: "No-show", cls: "bg-red-100 text-red-900", bar: "bg-red-600" },
};

export const SOURCE_LABEL: Record<AppointmentSource, string> = {
  ai_phone: "AI phone",
  website: "Online",
  manual: "Phone/manual",
  walk_in: "Walk-in",
  rebooking: "Rebooked",
};

export function StatusBadge({ status }: { status: AppointmentStatus }) {
  const s = STATUS_STYLE[status];
  return <span className={cn("inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold", s.cls)}>{s.label}</span>;
}

export function Pill({ className, ...p }: React.HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn("inline-flex items-center gap-1 rounded-full bg-ink-900/6 px-2.5 py-1 text-xs font-medium text-ink-700", className)} {...p} />;
}
