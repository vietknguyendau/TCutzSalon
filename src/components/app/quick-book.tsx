"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Footprints, Loader2, Plus, Search, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/primitives";
import { searchCustomersAction, staffBookAction, staffSlotsAction } from "@/app/app/actions";
import { formatPrice } from "@/lib/money";
import { formatPhoneUS } from "@/lib/phone";
import { cn } from "@/lib/utils";

export interface SvcOpt { id: string; name: string; priceCents: number; priceType: "fixed" | "starting_at"; durationMinutes: number }
export interface StaffOpt { id: string; name: string; color: string; serviceIds: string[] }
interface CustOpt { id: string; name: string; phone?: string; usualServiceId?: string; preferredStaffId?: string }
export interface Prefill { customer?: CustOpt; serviceId?: string; staffId?: string; mode?: "book" | "walkin" }

const newKey = () => crypto.randomUUID().replace(/-/g, "");
function addDays(date: string, n: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function QuickBookButtons(props: { services: SvcOpt[]; staff: StaffOpt[]; today: string; timezone: string; prefill?: Prefill }) {
  const [open, setOpen] = useState<null | "book" | "walkin">(props.prefill?.mode ?? null);
  return (
    <>
      <div className="flex gap-2">
        <Button variant="gold" size="lg" onClick={() => setOpen("book")}>
          <Plus /> Book
        </Button>
        <Button variant="dark" size="lg" onClick={() => setOpen("walkin")}>
          <Footprints /> Walk-in
        </Button>
      </div>
      {open && <QuickBookSheet {...props} mode={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function QuickBookSheet({ services, staff, today, timezone, prefill, mode, onClose }: {
  services: SvcOpt[]; staff: StaffOpt[]; today: string; timezone: string; prefill?: Prefill; mode: "book" | "walkin"; onClose: () => void;
}) {
  const router = useRouter();
  const [customer, setCustomer] = useState<CustOpt | undefined>(prefill?.customer);
  const [newCust, setNewCust] = useState({ firstName: "", phone: "" });
  const [creating, setCreating] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<CustOpt[]>([]);
  const [serviceId, setServiceId] = useState(prefill?.serviceId ?? prefill?.customer?.usualServiceId);
  const [chosenStaffId, setStaffId] = useState(prefill?.staffId ?? prefill?.customer?.preferredStaffId ?? staff[0]?.id);
  const [date, setDate] = useState(today);
  const [slotRes, setSlotRes] = useState<{ key: string; slots: string[] }>();
  const [picked, setStartsAt] = useState<{ key: string; at: string }>();
  const [error, setError] = useState<string>();
  const [saving, startSave] = useTransition();
  const key = useRef(newKey());

  const timeFmt = useMemo(() => new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: timezone }), [timezone]);
  const qualified = staff.filter((s) => !serviceId || s.serviceIds.includes(serviceId));
  // If the chosen stylist doesn't do the chosen service, fall back to the first one who does.
  const staffId = qualified.some((s) => s.id === chosenStaffId) ? chosenStaffId : qualified[0]?.id;
  const slotKey = `${serviceId}|${staffId}|${date}`;
  const slots = slotRes?.key === slotKey ? slotRes.slots : null;
  const startsAt = picked?.key === slotKey ? picked.at : undefined;
  const shownResults = q.trim().length >= 2 ? results : [];

  useEffect(() => {
    if (q.trim().length < 2) return;
    const t = setTimeout(() => searchCustomersAction(q).then(setResults), 200);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    if (mode === "walkin" || !serviceId || !staffId) return;
    let live = true;
    const key = `${serviceId}|${staffId}|${date}`;
    staffSlotsAction(serviceId, staffId, date).then((s) => live && setSlotRes({ key, slots: s }));
    return () => { live = false; };
  }, [serviceId, staffId, date, mode]);

  const submit = () =>
    startSave(async () => {
      setError(undefined);
      const start = mode === "walkin" ? roundNow() : startsAt;
      if (!serviceId || !staffId || !start) return setError("Pick a service, stylist and time.");
      const r = await staffBookAction({
        serviceId,
        staffId,
        startsAt: start,
        customerId: customer?.id,
        firstName: !customer && newCust.firstName ? newCust.firstName : undefined,
        phone: !customer && newCust.phone ? newCust.phone : undefined,
        source: mode === "walkin" ? "walk_in" : prefill?.customer ? "rebooking" : "manual",
        idempotencyKey: key.current,
      });
      if (r.ok) {
        onClose();
        router.replace("/app/today");
        router.refresh();
      } else {
        key.current = newKey();
        setError(r.error);
      }
    });

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink-950/50 sm:items-center" role="dialog" aria-modal aria-label={mode === "walkin" ? "Walk-in" : "New appointment"}>
      <div className="max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl bg-cream-50 p-5 sm:max-w-2xl sm:rounded-3xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-2xl">{mode === "walkin" ? "Walk-in — starting now" : "New appointment"}</h2>
          <button onClick={onClose} className="flex size-12 items-center justify-center rounded-full hover:bg-ink-900/5" aria-label="Close">
            <X />
          </button>
        </div>

        <section className="mb-5">
          <Label>Customer</Label>
          {customer ? (
            <div className="flex items-center justify-between rounded-xl border-2 border-gold-500 bg-white px-4 py-3">
              <div>
                <p className="font-semibold">{customer.name}</p>
                {customer.phone && <p className="text-sm text-ink-400">{formatPhoneUS(customer.phone)}</p>}
              </div>
              <Button variant="ghost" size="sm" onClick={() => setCustomer(undefined)}>Change</Button>
            </div>
          ) : creating ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <Input placeholder="First name" value={newCust.firstName} onChange={(e) => setNewCust({ ...newCust, firstName: e.target.value })} autoFocus />
              <Input placeholder="Phone (optional)" type="tel" value={newCust.phone} onChange={(e) => setNewCust({ ...newCust, phone: e.target.value })} />
            </div>
          ) : (
            <>
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-ink-400" />
                <Input className="pl-11" placeholder="Search name or phone" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
              {shownResults.length > 0 && (
                <ul className="mt-2 divide-y divide-ink-900/8 rounded-xl border border-ink-900/10 bg-white">
                  {shownResults.map((r) => (
                    <li key={r.id}>
                      <button
                        className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-cream-100"
                        onClick={() => {
                          setCustomer(r);
                          if (r.usualServiceId) setServiceId(r.usualServiceId);
                          if (r.preferredStaffId) setStaffId(r.preferredStaffId);
                        }}
                      >
                        <span className="font-medium">{r.name}</span>
                        <span className="text-sm text-ink-400">{formatPhoneUS(r.phone)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <Button variant="outline" className="mt-2" onClick={() => setCreating(true)}>
                <UserPlus /> New customer
              </Button>
              {mode === "walkin" && <p className="mt-2 text-sm text-ink-400">Or leave empty for an anonymous walk-in.</p>}
            </>
          )}
        </section>

        <section className="mb-5">
          <Label>Service</Label>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {services.map((s) => (
              <button
                key={s.id}
                onClick={() => setServiceId(s.id)}
                className={cn("min-h-16 rounded-xl border-2 bg-white px-3 py-2 text-left", serviceId === s.id ? "border-gold-500 bg-gold-300/30" : "border-ink-900/10")}
              >
                <span className="block text-[15px] leading-tight font-semibold">{s.name}</span>
                <span className="text-sm text-ink-400">{formatPrice(s.priceCents, s.priceType)} · {s.durationMinutes}m</span>
              </button>
            ))}
          </div>
        </section>

        <section className="mb-5">
          <Label>Stylist</Label>
          <div className="flex flex-wrap gap-2">
            {qualified.map((s) => (
              <button key={s.id} onClick={() => setStaffId(s.id)} className={cn("flex h-12 items-center gap-2 rounded-xl border-2 bg-white px-4 font-semibold", staffId === s.id ? "border-gold-500" : "border-ink-900/10")}>
                <span className="size-3 rounded-full" style={{ background: s.color }} /> {s.name}
              </button>
            ))}
          </div>
        </section>

        {mode === "book" && (
          <section className="mb-5">
            <Label>Time</Label>
            <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
              {Array.from({ length: 14 }, (_, i) => addDays(today, i)).map((d) => (
                <button key={d} onClick={() => setDate(d)} className={cn("h-12 shrink-0 rounded-xl border-2 px-3 text-sm font-semibold", d === date ? "border-ink-900 bg-ink-900 text-cream-50" : "border-ink-900/10 bg-white")}>
                  {d === today ? "Today" : new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`))}
                </button>
              ))}
            </div>
            {slots === null ? (
              <p className="flex items-center gap-2 text-ink-400"><Loader2 className="size-4 animate-spin" /> Checking openings…</p>
            ) : slots.length === 0 ? (
              <p className="text-ink-600">No openings that day for this stylist.</p>
            ) : (
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                {slots.map((s) => (
                  <button key={s} onClick={() => setStartsAt({ key: slotKey, at: s })} className={cn("h-12 rounded-xl border-2 text-[15px] font-semibold tabular-nums", startsAt === s ? "border-gold-500 bg-gold-500" : "border-ink-900/10 bg-white")}>
                    {timeFmt.format(new Date(s))}
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        {error && <p className="mb-3 rounded-xl bg-red-50 px-4 py-3 text-red-800" role="alert">{error}</p>}
        <Button variant="gold" size="lg" className="w-full" onClick={submit} disabled={saving || !serviceId || !staffId || (mode === "book" && !startsAt)}>
          {saving ? <Loader2 className="animate-spin" /> : <Check />} {mode === "walkin" ? "Check in walk-in" : "Book appointment"}
        </Button>
      </div>
    </div>
  );
}

function roundNow(): string {
  const d = new Date();
  d.setSeconds(0, 0);
  d.setMinutes(Math.floor(d.getMinutes() / 5) * 5);
  return d.toISOString();
}
