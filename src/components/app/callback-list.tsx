"use client";

import { useTransition } from "react";
import { Check, MessageSquareText, Phone, PhoneMissed, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { resolveCallbackAction } from "@/app/app/actions";
import { formatPhoneUS } from "@/lib/phone";

export interface CallbackItem {
  id: string;
  name?: string;
  phone: string;
  reason: "landline_missed_call" | "customer_asked" | "sms_reply" | "ai_escalation";
  message?: string;
  language?: "en" | "vi";
  ago: string;
}

const REASON: Record<CallbackItem["reason"], { label: string; icon: React.ReactNode }> = {
  landline_missed_call: { label: "Missed call from a landline — can't text", icon: <PhoneMissed className="size-4" /> },
  customer_asked: { label: "Asked for a call back", icon: <Phone className="size-4" /> },
  sms_reply: { label: "Texted the salon", icon: <MessageSquareText className="size-4" /> },
  ai_escalation: { label: "AI receptionist handed off", icon: <Phone className="size-4" /> },
};

export function CallbackList({ items }: { items: CallbackItem[] }) {
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="cb" className="mb-6 rounded-2xl border-2 border-gold-500/60 bg-gold-300/25 p-4">
      <h2 id="cb" className="mb-3 flex items-center gap-2 text-lg font-semibold text-ink-900">
        <Phone className="size-5 text-gold-700" /> Call back ({items.length})
      </h2>
      <ul className="grid gap-2">
        {items.map((c) => (
          <CallbackRow key={c.id} c={c} />
        ))}
      </ul>
    </section>
  );
}

function CallbackRow({ c }: { c: CallbackItem }) {
  const [pending, start] = useTransition();
  const r = REASON[c.reason];
  return (
    <li className="flex flex-col gap-3 rounded-xl bg-white p-3 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <p className="text-[17px] font-semibold">
          {c.name ?? formatPhoneUS(c.phone)}
          {c.language === "vi" && <span className="ml-2 rounded-full bg-ink-900/6 px-2 py-0.5 text-xs font-medium">Tiếng Việt</span>}
        </p>
        <p className="flex items-center gap-1.5 text-sm text-ink-600">
          {r.icon} {r.label} · {c.ago}
          {c.name && <span className="hidden text-ink-400 sm:inline"> · {formatPhoneUS(c.phone)}</span>}
        </p>
        {c.message && <p className="mt-1 text-[15px] whitespace-pre-line text-ink-800 italic">“{c.message}”</p>}
      </div>
      <div className="flex shrink-0 gap-2">
        <a href={`tel:${c.phone}`} className="inline-flex h-12 items-center gap-2 rounded-xl bg-ink-900 px-4 font-semibold text-cream-50">
          <Phone className="size-5" /> Call
        </a>
        <Button variant="success" size="icon" aria-label="Mark done" disabled={pending} onClick={() => start(async () => { await resolveCallbackAction(c.id, "done"); })}>
          <Check />
        </Button>
        <Button variant="outline" size="icon" aria-label="Dismiss" disabled={pending} onClick={() => start(async () => { await resolveCallbackAction(c.id, "dismissed"); })}>
          <X />
        </Button>
      </div>
    </li>
  );
}
