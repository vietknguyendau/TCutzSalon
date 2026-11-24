import { CheckCircle2, CircleDashed } from "lucide-react";
import { Card } from "@/components/ui/primitives";

export const metadata = { title: "AI Receptionist" };

const READY = [
  "Single booking API with conflict-safe, idempotent booking (the AI will call this — it can never confirm without it)",
  "Real-time availability incl. “nearest open times” for “3:00 is booked, 3:30 is open” answers",
  "Per-service “AI can book this” switch",
  "Bilingual service names and prices (English / Vietnamese)",
];
const NEXT = [
  "Retell vs. Vapi test calls in Vietnamese and English (scripted, 40 calls)",
  "Signed voice-agent tool endpoints (get_services … send_appointment_confirmation)",
  "Simulated phone booking environment (no real number)",
  "Call forwarding pilot from the salon's existing number (carrier check needed)",
  "Transfer-to-owner and callback requests",
  "Call logs and minutes in Analytics",
];

export default function ReceptionistPage() {
  return (
    <div className="max-w-3xl">
      <h1 className="font-display text-3xl">AI Receptionist</h1>
      <p className="mb-6 text-ink-600">Not connected yet — this is Phase 2. No calls are answered by AI today.</p>
      <Card className="mb-4 p-5">
        <h2 className="mb-3 font-semibold">Already built (foundation)</h2>
        <ul className="space-y-2">{READY.map((r) => <li key={r} className="flex gap-2"><CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-700" /> {r}</li>)}</ul>
      </Card>
      <Card className="p-5">
        <h2 className="mb-3 font-semibold">Coming in Phase 2</h2>
        <ul className="space-y-2">{NEXT.map((r) => <li key={r} className="flex gap-2"><CircleDashed className="mt-0.5 size-5 shrink-0 text-gold-600" /> {r}</li>)}</ul>
      </Card>
    </div>
  );
}
