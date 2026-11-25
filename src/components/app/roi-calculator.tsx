"use client";

import { useState } from "react";
import { calculateRoi, DEFAULT_ROI_INPUTS, type RoiInputs } from "@/lib/roi";
import { Input, Label } from "@/components/ui/primitives";
import { formatMoney } from "@/lib/money";

export function RoiCalculator() {
  const [i, setI] = useState<RoiInputs>(DEFAULT_ROI_INPUTS);
  const r = calculateRoi(i);
  const field = (k: keyof RoiInputs, label: string, opts: { cents?: boolean; suffix?: string; help?: string } = {}) => (
    <div>
      <Label htmlFor={k}>{label}</Label>
      <div className="relative">
        {opts.cents && <span className="absolute top-1/2 left-4 -translate-y-1/2 text-ink-400">$</span>}
        <Input
          id={k}
          type="number"
          inputMode="decimal"
          min={0}
          className={opts.cents ? "pl-8" : ""}
          value={opts.cents ? i[k] / 100 : i[k]}
          onChange={(e) => {
            const n = Math.max(0, Number(e.target.value) || 0);
            setI({ ...i, [k]: opts.cents ? Math.round(n * 100) : n });
          }}
        />
        {opts.suffix && <span className="absolute top-1/2 right-4 -translate-y-1/2 text-ink-400">{opts.suffix}</span>}
      </div>
      {opts.help && <p className="mt-1 text-xs text-ink-400">{opts.help}</p>}
    </div>
  );
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="grid gap-4">
        {field("averageServiceCents", "Average service price", { cents: true })}
        {field("variableExpensePct", "Variable expenses (products, card fees)", { suffix: "%" })}
        {field("monthlyFeeCents", "Monthly subscription", { cents: true })}
        {field("setupFeeCents", "One-time setup fee", { cents: true })}
        {field("additionalAppointmentsPerMonth", "Truly additional appointments / month", {
          help: "Only bookings that would otherwise be lost (missed calls, after-hours). Not every AI-booked appointment is new business.",
        })}
      </div>
      <div className="rounded-2xl bg-ink-950 p-6 text-cream-100">
        <Big label="Contribution per extra appointment" value={formatMoney(r.contributionPerAppointmentCents)} />
        <Big label="Extra appointments to break even" value={Number.isFinite(r.breakEvenAppointmentsPerMonth) ? `${r.breakEvenAppointmentsPerMonth} / month` : "—"} accent />
        <Big label="Incremental revenue" value={`${formatMoney(r.incrementalRevenueMonthlyCents)} / month`} />
        <Big label="Incremental profit after subscription" value={`${formatMoney(r.incrementalProfitMonthlyCents)} / month`} />
        <Big label="Annual ROI (incl. setup)" value={r.annualRoiPct === null ? "—" : `${r.annualRoiPct}%`} />
        <p className="mt-4 text-xs text-cream-100/50">Illustrative estimate, not a guarantee. Compare against the pre-launch baseline in Analytics.</p>
      </div>
    </div>
  );
}

function Big({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="border-b border-cream-100/10 py-3 last:border-0">
      <p className="text-sm text-cream-100/60">{label}</p>
      <p className={`font-display text-2xl ${accent ? "text-gold-400" : "text-cream-50"}`}>{value}</p>
    </div>
  );
}
