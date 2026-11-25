import { CheckCircle2, CircleDashed, MessageSquareText, PhoneMissed } from "lucide-react";
import { getStaffContext } from "@/lib/auth";
import { Card, Pill } from "@/components/ui/primitives";
import { TextBackSimulator } from "@/components/app/textback-simulator";
import { formatPhoneUS, maskPhone } from "@/lib/phone";
import { daysAgo, timeAgo } from "@/lib/time-ago";
import { cn } from "@/lib/utils";

export const metadata = { title: "Phone & texts" };

const STATUS_CLS: Record<string, string> = {
  sent: "bg-emerald-100 text-emerald-900",
  delivered: "bg-emerald-100 text-emerald-900",
  test_mode: "bg-sky-100 text-sky-900",
  queued: "bg-amber-100 text-amber-900",
  failed: "bg-red-100 text-red-900",
  suppressed: "bg-ink-900/8 text-ink-600",
};
const STATUS_LABEL: Record<string, string> = { test_mode: "test mode", queued: "waiting (quiet hours)" };

const NEXT = [
  "Retell vs. Vapi test calls in Vietnamese and English (scripted, 40 calls)",
  "AI answers instead of the greeting; books through the same booking API",
  "Transfer to the owner, and AI escalations onto the call-back list",
];

export default async function ReceptionistPage() {
  const ctx = await getStaffContext();
  const since = daysAgo(7);
  const [calls, texts] = await Promise.all([ctx.store.listCalls(ctx.salon.id, since), ctx.store.listNotifications(ctx.salon.id, 30)]);
  const cfg = ctx.salon.settings.missedCallTextBack;
  const missed = calls.filter((c) => c.outcome === "missed" || c.outcome === "abandoned").length;
  const textBacks = texts.filter((t) => t.template.startsWith("missed_call"));

  return (
    <div>
      <h1 className="font-display text-3xl">Phone &amp; texts</h1>
      <p className="mb-6 text-ink-600">When nobody can pick up, the caller gets a text with the booking link — so a missed call isn&apos;t a lost customer.</p>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card className="p-4">
          <p className="text-sm text-ink-600">Missed-call texts</p>
          <p className={cn("text-xl font-bold", cfg.enabled ? "text-emerald-700" : "text-ink-400")}>{cfg.enabled ? "On" : "Off"}</p>
          <p className="text-xs text-ink-400">1 per number / {cfg.dedupeHours} h · quiet {ctx.salon.settings.quietHours.start}–{ctx.salon.settings.quietHours.end}</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-ink-600">Missed calls · 7 days</p>
          <p className="text-2xl font-bold tabular-nums">{missed}</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-ink-600">Texts sent · 7 days</p>
          <p className="text-2xl font-bold tabular-nums">{textBacks.filter((t) => t.status !== "queued" && t.status !== "failed" && t.status !== "suppressed").length}</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-ink-600">Salon texting number</p>
          <p className="text-lg font-bold">{ctx.salon.providerNumber ? formatPhoneUS(ctx.salon.providerNumber) : "Not connected"}</p>
          {ctx.salon.isDemo && <p className="text-xs text-ink-400">fictional demo number</p>}
        </Card>
      </div>

      {ctx.salon.isDemo && (
        <Card className="mb-8 p-5">
          <h2 className="mb-1 text-xl font-semibold">Try it: simulate a missed call</h2>
          <p className="mb-4 text-ink-600">Runs the same rules a real call would. Nothing is texted — this is the demo salon.</p>
          <TextBackSimulator />
        </Card>
      )}

      <div className="mb-8 grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold"><PhoneMissed className="size-5 text-gold-700" /> Recent calls</h2>
          {calls.length === 0 ? (
            <p className="text-ink-600">No calls yet.</p>
          ) : (
            <ul className="divide-y divide-ink-900/8">
              {calls.slice(0, 12).map((c) => (
                <li key={c.id} className="flex items-center justify-between py-2.5 text-[15px]">
                  <span>{c.fromE164 ? maskPhone(c.fromE164) : "Blocked number"} {c.language === "vi" && <Pill className="ml-1">VI</Pill>}</span>
                  <span className="text-ink-400">{c.outcome ?? "in progress"} · {timeAgo(c.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="p-5">
          <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold"><MessageSquareText className="size-5 text-gold-700" /> Recent texts</h2>
          {texts.length === 0 ? (
            <p className="text-ink-600">No texts yet.</p>
          ) : (
            <ul className="divide-y divide-ink-900/8">
              {texts.slice(0, 10).map((t) => (
                <li key={t.id} className="py-2.5">
                  <p className="flex items-center justify-between gap-2 text-sm">
                    <span className="font-medium">{maskPhone(t.toAddress)}</span>
                    <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", STATUS_CLS[t.status])}>{STATUS_LABEL[t.status] ?? t.status}</span>
                  </p>
                  <p className="mt-0.5 line-clamp-2 text-sm text-ink-600">{t.body}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="p-5">
        <h2 className="mb-3 font-semibold">AI receptionist — next</h2>
        <ul className="space-y-2">
          <li className="flex gap-2"><CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-700" /> Missed-call texts, call log, opt-outs and call-back list (this page)</li>
          {NEXT.map((r) => <li key={r} className="flex gap-2"><CircleDashed className="mt-0.5 size-5 shrink-0 text-gold-600" /> {r}</li>)}
        </ul>
      </Card>
    </div>
  );
}
