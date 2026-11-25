"use client";

import { useState, useTransition } from "react";
import { Loader2, MessageSquareReply, PhoneIncoming } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/primitives";
import { simulateMissedCallAction, simulateReplyAction } from "@/app/app/actions";
import { cn } from "@/lib/utils";

const PRESETS = [
  { phone: "(763) 555-0177", label: "New caller · mobile" },
  { phone: "(763) 555-0101", label: "Minh · Vietnamese regular" },
  { phone: "(763) 555-0103", label: "Linh · already booked" },
  { phone: "(763) 555-0102", label: "Robert · landline" },
];

const EXPLAIN: Record<string, string> = {
  send: "Text sent right away (test mode — nothing actually leaves the system).",
  schedule: "It's quiet hours, so the text is held and goes out at 9:00 AM.",
  LANDLINE: "Landline — it can't receive texts. Added to the owner's call-back list instead.",
  RECENTLY_TEXTED: "Already texted this number in the last 12 hours — no second text.",
  OPTED_OUT: "This number replied STOP — the salon never texts it again unless they send START.",
  NOT_A_MISSED_CALL: "The AI booked them, so no follow-up text is needed (they get the normal confirmation).",
  NO_CALLER_ID: "Caller ID was blocked — nothing to text.",
  DISABLED: "Missed-call texts are turned off for this salon.",
};

type SimResult = Awaited<ReturnType<typeof simulateMissedCallAction>>;

export function TextBackSimulator() {
  const [phone, setPhone] = useState(PRESETS[0].phone);
  const [language, setLanguage] = useState<"en" | "vi" | "">("");
  const [outcome, setOutcome] = useState<"missed" | "booked">("missed");
  const [when, setWhen] = useState<"now" | "afternoon" | "tonight">("afternoon");
  const [result, setResult] = useState<SimResult>();
  const [thread, setThread] = useState<{ from: "them" | "salon"; text: string }[]>([]);
  const [reply, setReply] = useState("");
  const [pending, start] = useTransition();

  const run = () =>
    start(async () => {
      const r = await simulateMissedCallAction({ phone, language: language || undefined, outcome, when });
      setResult(r);
      setThread(r.ok && r.text ? [{ from: "salon", text: r.text.body }] : []);
    });
  const sendReply = (text: string) =>
    start(async () => {
      const r = await simulateReplyAction(phone, text);
      setThread((t) => [...t, { from: "them", text }, ...(r.ok && r.reply ? [{ from: "salon" as const, text: r.reply }] : [])]);
      if (r.ok && r.intent === "opt_out") setThread((t) => [...t, { from: "salon", text: "(Carrier sends its standard opt-out confirmation.)" }]);
      setReply("");
    });

  const key = result?.ok ? (result.decision.action === "skip" ? result.decision.reason : result.decision.action) : undefined;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="grid gap-4">
        <div>
          <Label>Who&apos;s calling?</Label>
          <div className="mb-2 grid grid-cols-2 gap-2">
            {PRESETS.map((p) => (
              <button key={p.phone} onClick={() => setPhone(p.phone)} className={cn("min-h-12 rounded-xl border-2 bg-white px-3 py-2 text-left text-sm font-semibold", phone === p.phone ? "border-gold-500" : "border-ink-900/10")}>
                {p.label}
                <span className="block font-normal text-ink-400">{p.phone}</span>
              </button>
            ))}
          </div>
          <Input aria-label="Caller phone" value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" />
        </div>
        <Seg label="Language on the call" value={language} onChange={setLanguage} options={[["", "Didn't choose"], ["vi", "Pressed 2 · Tiếng Việt"], ["en", "English"]]} />
        <Seg label="What happened" value={outcome} onChange={setOutcome} options={[["missed", "Nobody answered"], ["booked", "AI booked them"]]} />
        <Seg label="When" value={when} onChange={setWhen} options={[["afternoon", "2:00 PM today"], ["now", "Right now"], ["tonight", "9:45 PM tonight"]]} />
        <Button variant="gold" size="lg" onClick={run} disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <PhoneIncoming />} Simulate the call ending
        </Button>
      </div>

      <div className="rounded-3xl bg-ink-950 p-5 text-cream-100">
        <p className="mb-3 text-xs font-semibold tracking-wider text-gold-500 uppercase">Caller&apos;s phone</p>
        {!result && <p className="text-cream-100/60">Run a simulation to see what the caller receives.</p>}
        {result && !result.ok && <p className="text-red-200">{result.error}</p>}
        {result?.ok && key && (
          <p className={cn("mb-4 rounded-xl px-3 py-2 text-sm", result.decision.action === "skip" ? "bg-cream-100/10" : "bg-emerald-500/20 text-emerald-100")} role="status">
            {EXPLAIN[key] ?? key}
            {result.text?.status === "queued" && ` Scheduled for ${new Date(result.text.scheduledFor).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" })}.`}
          </p>
        )}
        <div className="space-y-2" aria-live="polite" role="log" aria-label="Simulated text thread">
          {thread.map((m, i) => (
            <p key={i} className={cn("max-w-[85%] rounded-2xl px-3.5 py-2 text-[15px] leading-snug", m.from === "salon" ? "bg-cream-100 text-ink-950" : "ml-auto bg-sky-600 text-white")}>
              {m.text}
            </p>
          ))}
        </div>
        {result?.ok && result.text && (
          <div className="mt-5 border-t border-cream-100/10 pt-4">
            <p className="mb-2 flex items-center gap-1.5 text-sm text-cream-100/70">
              <MessageSquareReply className="size-4" /> Reply as the caller
            </p>
            <div className="mb-2 flex flex-wrap gap-2">
              {["CALL", "GỌI", "STOP", "Can I come at 3 today?"].map((q) => (
                <button key={q} onClick={() => sendReply(q)} disabled={pending} className="h-10 rounded-full border border-cream-100/20 px-3 text-sm hover:border-gold-500">
                  {q}
                </button>
              ))}
            </div>
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (reply.trim()) sendReply(reply.trim()); }}>
              <Input value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Type a reply…" className="border-cream-100/20 bg-ink-900 text-cream-50" />
              <Button type="submit" variant="gold" disabled={pending || !reply.trim()}>Send</Button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}

function Seg<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={label}>
        {options.map(([v, l]) => (
          <button key={v} role="radio" aria-checked={value === v} onClick={() => onChange(v)} className={cn("h-11 rounded-xl border-2 px-3 text-sm font-semibold", value === v ? "border-ink-900 bg-ink-900 text-cream-50" : "border-ink-900/10 bg-white")}>
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}
