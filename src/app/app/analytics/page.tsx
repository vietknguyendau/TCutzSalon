import { getStaffContext } from "@/lib/auth";
import { dayStats, loadRange, todayLocal } from "@/lib/dashboard";
import { addDays } from "@/lib/scheduling/time";
import { formatMoney } from "@/lib/money";
import { daysAgo } from "@/lib/time-ago";
import { Card, SOURCE_LABEL } from "@/components/ui/primitives";
import { RoiCalculator } from "@/components/app/roi-calculator";
import type { AppointmentSource } from "@/lib/domain/types";

export const metadata = { title: "Analytics" };

export default async function AnalyticsPage() {
  const ctx = await getStaffContext();
  const today = todayLocal(ctx);
  const { appointments } = await loadRange(ctx, addDays(today, -6), 9);
  const s = dayStats(appointments);
  const completed = appointments.filter((e) => e.appt.status === "completed");
  const aiCompleted = completed.filter((e) => e.appt.source === "ai_phone");
  const returning = new Set(appointments.filter((e) => e.isReturning).map((e) => e.customer?.id)).size;
  const fresh = new Set(appointments.filter((e) => !e.isReturning && e.customer).map((e) => e.customer?.id)).size;
  const avg = completed.length ? Math.round(s.completedCents / completed.length) : 0;
  const total = Object.values(s.bySource).reduce((a, b) => a + b, 0) || 1;
  const [calls, texts] = await Promise.all([
    ctx.store.listCalls(ctx.salon.id, daysAgo(7)),
    ctx.store.listNotifications(ctx.salon.id, 500),
  ]);
  const missedCalls = calls.filter((c) => c.outcome === "missed" || c.outcome === "abandoned").length;
  const textBacks = texts.filter((t) => t.template.startsWith("missed_call") && !["queued", "failed", "suppressed"].includes(t.status)).length;
  const recovered = appointments.filter((e) => e.appt.attribution === "missed_call_text" && e.appt.status !== "canceled");

  return (
    <div>
      <h1 className="font-display text-3xl">Analytics</h1>
      <p className="mb-6 text-ink-600">Last 7 days + next 2 days{ctx.demo && " · demo data"}</p>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Booked (active)" value={String(s.count)} />
        <Metric label="Completed revenue" value={formatMoney(s.completedCents)} />
        <Metric label="Avg service value" value={formatMoney(avg)} />
        <Metric label="No-shows" value={String(s.noShows)} />
        <Metric label="Returning customers" value={String(returning)} />
        <Metric label="New customers" value={String(fresh)} />
        <Metric label="Revenue from AI-booked (completed)" value={formatMoney(aiCompleted.reduce((a, e) => a + (e.appt.finalPriceCents ?? 0), 0))} sub="Associated, not necessarily incremental" />
        <Metric label="Missed calls" value={String(missedCalls)} />
        <Metric label="Missed-call texts sent" value={String(textBacks)} />
        <Metric
          label="Booked from a missed-call text"
          value={String(recovered.length)}
          sub={`${formatMoney(recovered.reduce((a, e) => a + (e.appt.finalPriceCents ?? e.appt.estimatedPriceCents), 0))} · closest to truly new business`}
        />
        <Metric label="AI call minutes" value="—" sub="Starts with the AI receptionist" />
      </div>

      <Card className="mb-8 p-5">
        <h2 className="mb-4 text-xl font-semibold">Where bookings come from</h2>
        <div className="space-y-3">
          {(Object.keys(SOURCE_LABEL) as AppointmentSource[]).map((k) => {
            const n = s.bySource[k] ?? 0;
            return (
              <div key={k} className="flex items-center gap-3">
                <span className="w-32 shrink-0 text-[15px] text-ink-700">{SOURCE_LABEL[k]}</span>
                <span className="h-7 flex-1 overflow-hidden rounded-lg bg-cream-100">
                  <span className="block h-full rounded-lg bg-gold-500" style={{ width: `${(n / total) * 100}%` }} />
                </span>
                <span className="w-8 text-right font-semibold tabular-nums">{n}</span>
              </div>
            );
          })}
        </div>
      </Card>

      <h2 className="mb-1 text-xl font-semibold">ROI calculator</h2>
      <p className="mb-4 text-ink-600">Defaults are illustrative for Tcutz: $30 men&apos;s cut, 15% variable expense, $149/month.</p>
      <RoiCalculator />
      <p className="mt-6 text-sm text-ink-400">Baseline comparison (before vs. after launch) needs a recorded baseline period — planned for Phase 3.</p>
    </div>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="p-4">
      <p className="text-sm text-ink-600">{label}</p>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      {sub && <p className="text-xs text-ink-400">{sub}</p>}
    </Card>
  );
}
