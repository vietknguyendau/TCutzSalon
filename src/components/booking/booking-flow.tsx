"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, ChevronRight, Clock, Loader2, Phone, RotateCcw, Scissors, Sparkles, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/primitives";
import { dict, formatDateLong, formatDateParts, type Dict } from "@/lib/i18n/dict";
import { formatPrice } from "@/lib/money";
import { formatPhoneUS } from "@/lib/phone";
import { cn } from "@/lib/utils";

type Lang = "en" | "vi";
export interface PublicService {
  id: string;
  nameEn: string;
  nameVi: string;
  priceCents: number;
  priceType: "fixed" | "starting_at";
  durationMinutes: number;
  requiresApproval: boolean;
}
export interface PublicSalon {
  slug: string;
  name: string;
  phone: string;
  address: string;
  timezone: string;
  isDemo: boolean;
  window: { first: string; last: string };
  services: PublicService[];
  staff: { id: string; name: string; serviceIds: string[] }[];
}
interface Slot {
  start: string;
  end: string;
  staffIds: string[];
}
interface Profile {
  customerId: string;
  firstName: string;
  usualServiceId?: string;
  usualServiceName?: { en: string; vi: string };
  preferredStaffId?: string;
  lastVisitDate?: string;
}
type Step = "lang" | "service" | "staff" | "time" | "details" | "review" | "done";
const STEPS: Step[] = ["service", "staff", "time", "details", "review"];

function addDays(date: string, n: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const newKey = () => crypto.randomUUID().replace(/-/g, "");

export function BookingFlow({ salon, initialLang }: { salon: PublicSalon; initialLang?: Lang }) {
  const [lang, setLang] = useState<Lang>(initialLang ?? "en");
  const [step, setStep] = useState<Step>(initialLang ? "service" : "lang");
  const t: Dict = dict[lang];

  const [serviceId, setServiceId] = useState<string>();
  const [staffId, setStaffId] = useState<string | "any">("any");
  const [date, setDate] = useState(salon.window.first);
  const [slot, setSlot] = useState<Slot>();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [smsConsent, setSmsConsent] = useState(true);
  const [note, setNote] = useState("");
  const [verified, setVerified] = useState<{ token: string; customerId: string }>();
  const [result, setResult] = useState<{ status: string; manageUrl: string; startsAt: string; staffId: string }>();
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const idemKey = useRef(newKey());
  const topRef = useRef<HTMLDivElement>(null);

  const service = salon.services.find((s) => s.id === serviceId);
  const qualifiedStaff = salon.staff.filter((s) => !serviceId || s.serviceIds.includes(serviceId));
  const svcName = (s: PublicService | undefined) => (s ? (lang === "vi" ? s.nameVi : s.nameEn) : "");
  const timeFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(lang === "vi" ? "vi-VN" : "en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: lang !== "vi",
        timeZone: salon.timezone,
      }),
    [lang, salon.timezone],
  );

  const go = (s: Step) => {
    setError(undefined);
    setStep(s);
    requestAnimationFrame(() => topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  const chooseLang = (l: Lang) => {
    setLang(l);
    go("service");
  };

  const pickService = (id: string) => {
    setServiceId(id);
    setSlot(undefined);
    const qualified = salon.staff.filter((s) => s.serviceIds.includes(id));
    if (qualified.length <= 1) {
      setStaffId(qualified[0]?.id ?? "any");
      go("time");
    } else go("staff");
  };

  const applyProfile = (p: Profile, verifiedToken: string, verifiedPhone: string) => {
    setVerified({ token: verifiedToken, customerId: p.customerId });
    setFirstName(p.firstName);
    setPhone(verifiedPhone);
    if (p.usualServiceId && salon.services.some((s) => s.id === p.usualServiceId)) {
      setServiceId(p.usualServiceId);
      setStaffId(p.preferredStaffId && salon.staff.some((s) => s.id === p.preferredStaffId) ? p.preferredStaffId : "any");
      go("time");
    } else go("service");
  };

  async function submit() {
    if (!service || !slot) return;
    setSubmitting(true);
    setError(undefined);
    try {
      const res = await fetch(`/api/v1/salons/${salon.slug}/appointments`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idemKey.current },
        body: JSON.stringify({
          serviceId: service.id,
          staffId: staffId === "any" ? (slot.staffIds[0] ?? undefined) : staffId,
          startsAt: slot.start,
          firstName: firstName.trim(),
          lastName: lastName.trim() || undefined,
          phone,
          language: lang,
          smsConsent,
          note: note.trim() || undefined,
          customerId: verified?.customerId,
          verifiedToken: verified?.token,
        }),
      });
      const json = await res.json();
      if (json.ok) {
        setResult(json.data);
        go("done");
      } else if (res.status === 409) {
        idemKey.current = newKey();
        setSlot(undefined);
        go("time");
        setError(t.errorTaken);
      } else setError(res.status === 429 ? t.errorBusy : t.errorGeneric);
    } catch {
      setError(t.errorGeneric); // keep the same idempotency key so a retry can't double-book
    } finally {
      setSubmitting(false);
    }
  }

  const reset = () => {
    idemKey.current = newKey();
    setServiceId(undefined);
    setSlot(undefined);
    setResult(undefined);
    setNote("");
    go("service");
  };

  const stepIndex = STEPS.indexOf(step);
  const canDetails = firstName.trim().length > 0 && phone.replace(/\D/g, "").length >= 10;

  return (
    <div className="min-h-dvh bg-ink-950 text-cream-100">
      {salon.isDemo && (
        <div className="bg-gold-500 px-4 py-2 text-center text-sm font-semibold text-ink-950" role="status">
          {t.demoBanner}
        </div>
      )}
      <header className="mx-auto flex max-w-2xl items-center justify-between px-5 pt-6 pb-4">
        <div>
          <p className="text-xs font-medium tracking-[0.2em] text-gold-500 uppercase">{t.bookAt}</p>
          <h1 className="font-display text-3xl leading-tight text-cream-50 sm:text-4xl">{salon.name}</h1>
        </div>
        {step !== "lang" && (
          <div className="flex rounded-full border border-cream-100/15 p-1 text-sm" role="group" aria-label="Language">
            {(["en", "vi"] as const).map((l) => (
              <button
                key={l}
                onClick={() => setLang(l)}
                className={cn("h-9 min-w-12 rounded-full px-3 font-semibold", lang === l ? "bg-gold-500 text-ink-950" : "text-cream-100/70")}
                aria-pressed={lang === l}
              >
                {l === "en" ? "EN" : "VI"}
              </button>
            ))}
          </div>
        )}
      </header>

      <main ref={topRef} className="mx-auto max-w-2xl scroll-mt-4 px-5 pb-16">
        {stepIndex >= 0 && (
          <ol className="mb-6 flex gap-1.5" aria-label="Progress">
            {STEPS.map((s, i) => (
              <li key={s} className={cn("h-1.5 flex-1 rounded-full", i <= stepIndex ? "bg-gold-500" : "bg-cream-100/12")}>
                <span className="sr-only">{s}</span>
              </li>
            ))}
          </ol>
        )}

        {error && (
          <div className="mb-4 rounded-xl border border-red-400/40 bg-red-500/15 px-4 py-3 text-red-100" role="alert">
            {error}
          </div>
        )}

        {step === "lang" && (
          <section className="pt-6">
            <p className="mb-6 text-lg text-cream-100/80">
              Choose your language · <span lang="vi">Chọn ngôn ngữ</span>
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <LangButton onClick={() => chooseLang("en")} title="English" sub="Book in English" />
              <LangButton onClick={() => chooseLang("vi")} title="Tiếng Việt" sub="Đặt lịch bằng tiếng Việt" />
            </div>
            <CallCard salon={salon} t={dict.en} />
          </section>
        )}

        {step === "service" && (
          <section>
            <ReturningCustomer salon={salon} lang={lang} t={t} onProfile={applyProfile} />
            <h2 className="mt-8 mb-4 font-display text-2xl text-cream-50">{t.chooseService}</h2>
            <ul className="grid gap-2.5">
              {salon.services.map((s) => (
                <li key={s.id}>
                  <button
                    onClick={() => pickService(s.id)}
                    className={cn(
                      "group flex w-full items-center gap-4 rounded-2xl border bg-ink-900 px-5 py-4 text-left transition-colors hover:border-gold-500/60",
                      serviceId === s.id ? "border-gold-500" : "border-cream-100/10",
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-lg font-semibold text-cream-50">{svcName(s)}</p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-sm text-cream-100/60">
                        <span className="inline-flex items-center gap-1">
                          <Clock className="size-3.5" aria-hidden /> {s.durationMinutes} {t.minutes}
                        </span>
                        {s.requiresApproval && <span className="text-gold-400">{t.needsApproval}</span>}
                      </p>
                    </div>
                    <span className="font-display text-xl text-gold-400">{formatPrice(s.priceCents, s.priceType)}</span>
                    <ChevronRight className="size-5 text-cream-100/30 group-hover:text-gold-500" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
            <CallCard salon={salon} t={t} />
          </section>
        )}

        {step === "staff" && (
          <section>
            <BackButton t={t} onClick={() => go("service")} />
            <h2 className="mb-4 font-display text-2xl text-cream-50">{t.chooseStylist}</h2>
            <div className="grid gap-2.5">
              <ChoiceRow
                icon={<Sparkles className="size-5" />}
                title={t.firstAvailable}
                sub={t.firstAvailableHelp}
                active={staffId === "any"}
                onClick={() => {
                  setStaffId("any");
                  go("time");
                }}
              />
              {qualifiedStaff.map((s) => (
                <ChoiceRow
                  key={s.id}
                  icon={<UserRound className="size-5" />}
                  title={s.name}
                  active={staffId === s.id}
                  onClick={() => {
                    setStaffId(s.id);
                    go("time");
                  }}
                />
              ))}
            </div>
          </section>
        )}

        {step === "time" && service && (
          <TimePicker
            salon={salon}
            serviceId={service.id}
            staffId={staffId === "any" ? undefined : staffId}
            date={date}
            setDate={setDate}
            slot={slot}
            onPick={(s) => {
              setSlot(s);
              go(verified ? "review" : "details");
            }}
            onBack={() => go(qualifiedStaff.length > 1 ? "staff" : "service")}
            lang={lang}
            t={t}
            timeFmt={timeFmt}
            header={`${svcName(service)} · ${formatPrice(service.priceCents, service.priceType)}`}
          />
        )}

        {step === "details" && (
          <section>
            <BackButton t={t} onClick={() => go("time")} />
            <h2 className="mb-5 font-display text-2xl text-cream-50">{t.stepDetails}</h2>
            <form
              className="grid gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (canDetails) go("review");
              }}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="fn" className="text-cream-100/80">{t.firstName}</Label>
                  <Input id="fn" autoComplete="given-name" required value={firstName} onChange={(e) => setFirstName(e.target.value)} maxLength={60} />
                </div>
                <div>
                  <Label htmlFor="ln" className="text-cream-100/80">{t.lastName}</Label>
                  <Input id="ln" autoComplete="family-name" value={lastName} onChange={(e) => setLastName(e.target.value)} maxLength={60} />
                </div>
              </div>
              <div>
                <Label htmlFor="ph" className="text-cream-100/80">{t.yourPhone}</Label>
                <Input id="ph" type="tel" inputMode="tel" autoComplete="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(763) 555-0123" />
              </div>
              <label className="flex items-start gap-3 rounded-xl bg-ink-900 p-4 text-sm text-cream-100/80">
                <input type="checkbox" className="mt-0.5 size-5 accent-[#c9a96e]" checked={smsConsent} onChange={(e) => setSmsConsent(e.target.checked)} />
                <span>{t.smsConsent}</span>
              </label>
              <div>
                <Label htmlFor="note" className="text-cream-100/80">{t.note}</Label>
                <Textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
              </div>
              <Button type="submit" variant="gold" size="lg" disabled={!canDetails}>
                {t.next}
              </Button>
            </form>
          </section>
        )}

        {step === "review" && service && slot && (
          <section>
            <BackButton t={t} onClick={() => go(verified ? "time" : "details")} />
            <h2 className="mb-5 font-display text-2xl text-cream-50">{t.review}</h2>
            <dl className="divide-y divide-cream-100/10 rounded-2xl border border-cream-100/10 bg-ink-900">
              <Row label={t.service} value={svcName(service)} />
              <Row label={t.stylist} value={salon.staff.find((s) => s.id === (staffId === "any" ? slot.staffIds[0] : staffId))?.name ?? t.firstAvailable} />
              <Row label={t.when} value={`${formatDateLong(date, lang)} · ${timeFmt.format(new Date(slot.start))}`} />
              <Row label={t.price} value={formatPrice(service.priceCents, service.priceType)} />
              <Row label={t.firstName} value={`${firstName} · ${formatPhoneUS(phone.startsWith("+") ? phone : `+1${phone.replace(/\D/g, "").slice(-10)}`)}`} />
            </dl>
            {service.priceType === "starting_at" && <p className="mt-3 text-sm text-cream-100/60">{t.startingPriceNote}</p>}
            {service.requiresApproval && <p className="mt-2 text-sm text-gold-400">{t.needsApproval}</p>}
            <Button variant="gold" size="lg" className="mt-6 w-full" onClick={submit} disabled={submitting}>
              {submitting ? <Loader2 className="animate-spin" /> : <Check />} {t.confirm}
            </Button>
          </section>
        )}

        {step === "done" && result && service && (
          <section className="pt-4 text-center">
            <div className="mx-auto mb-5 flex size-16 items-center justify-center rounded-full bg-gold-500 text-ink-950">
              <Check className="size-8" strokeWidth={3} />
            </div>
            <h2 className="font-display text-3xl text-cream-50">{result.status === "pending_approval" ? t.requested : t.booked}</h2>
            <p className="mt-2 text-lg text-cream-100/80">
              {svcName(service)} · {formatDateLong(date, lang)} · {timeFmt.format(new Date(result.startsAt))}
            </p>
            <p className="mx-auto mt-4 max-w-md text-cream-100/70">{result.status === "pending_approval" ? t.requestedHelp : t.bookedHelp}</p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
              <a href={result.manageUrl} className="inline-flex h-14 items-center justify-center rounded-xl border-2 border-gold-500 px-6 font-semibold text-gold-400">
                {t.manage}
              </a>
              <Button variant="ghost" size="lg" className="text-cream-100/80 hover:bg-cream-100/10" onClick={reset}>
                <RotateCcw /> {t.bookAnother}
              </Button>
            </div>
          </section>
        )}
      </main>
      <footer className="pb-8 text-center text-xs text-cream-100/40">
        {salon.address} · {formatPhoneUS(salon.phone)}
      </footer>
    </div>
  );
}

function LangButton({ onClick, title, sub }: { onClick: () => void; title: string; sub: string }) {
  return (
    <button onClick={onClick} className="rounded-2xl border border-cream-100/12 bg-ink-900 p-6 text-left transition-colors hover:border-gold-500">
      <span className="block font-display text-3xl text-cream-50">{title}</span>
      <span className="mt-1 block text-cream-100/60">{sub}</span>
    </button>
  );
}

function ChoiceRow({ icon, title, sub, active, onClick }: { icon: React.ReactNode; title: string; sub?: string; active?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-4 rounded-2xl border bg-ink-900 px-5 py-4 text-left hover:border-gold-500/60",
        active ? "border-gold-500" : "border-cream-100/10",
      )}
    >
      <span className="flex size-11 items-center justify-center rounded-full bg-gold-500/15 text-gold-400">{icon}</span>
      <span className="flex-1">
        <span className="block text-lg font-semibold text-cream-50">{title}</span>
        {sub && <span className="block text-sm text-cream-100/60">{sub}</span>}
      </span>
      <ChevronRight className="size-5 text-cream-100/30" aria-hidden />
    </button>
  );
}

function BackButton({ t, onClick }: { t: Dict; onClick: () => void }) {
  return (
    <button onClick={onClick} className="mb-4 inline-flex h-11 items-center gap-1.5 rounded-lg pr-3 text-cream-100/70 hover:text-cream-50">
      <ArrowLeft className="size-5" /> {t.back}
    </button>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 px-5 py-4 sm:flex-row sm:justify-between sm:gap-6">
      <dt className="text-sm text-cream-100/55">{label}</dt>
      <dd className="font-medium text-cream-50 sm:text-right">{value}</dd>
    </div>
  );
}

function CallCard({ salon, t }: { salon: PublicSalon; t: Dict }) {
  return (
    <a href={`tel:${salon.phone}`} className="mt-8 flex items-center gap-3 rounded-2xl border border-cream-100/10 px-5 py-4 text-cream-100/70 hover:text-cream-50">
      <Phone className="size-5 text-gold-500" />
      <span>
        {t.callUs} <span className="font-semibold text-cream-50">{formatPhoneUS(salon.phone)}</span>
      </span>
    </a>
  );
}

function TimePicker(props: {
  salon: PublicSalon;
  serviceId: string;
  staffId?: string;
  date: string;
  setDate: (d: string) => void;
  slot?: Slot;
  onPick: (s: Slot) => void;
  onBack: () => void;
  lang: Lang;
  t: Dict;
  timeFmt: Intl.DateTimeFormat;
  header: string;
}) {
  const { salon, serviceId, staffId, date, setDate, onPick, lang, t, timeFmt } = props;
  const reqKey = `${serviceId}|${staffId ?? ""}|${date}`;
  const [res, setRes] = useState<{ key: string; slots?: Slot[]; failed?: boolean }>();
  const slots = res?.key === reqKey ? (res.slots ?? null) : null;
  const failed = res?.key === reqKey && !!res.failed;
  const days = useMemo(() => Array.from({ length: 21 }, (_, i) => addDays(salon.window.first, i)).filter((d) => d <= salon.window.last), [salon.window]);

  useEffect(() => {
    const ctrl = new AbortController();
    const key = `${serviceId}|${staffId ?? ""}|${date}`;
    const qs = new URLSearchParams({ serviceId, date, ...(staffId ? { staffId } : {}) });
    fetch(`/api/v1/salons/${salon.slug}/availability?${qs}`, { signal: ctrl.signal })
      .then((r) => r.json())
      .then((j) => setRes(j.ok ? { key, slots: j.data.slots } : { key, failed: true }))
      .catch((e) => e.name !== "AbortError" && setRes({ key, failed: true }));
    return () => ctrl.abort();
  }, [salon.slug, serviceId, staffId, date]);

  const groups = useMemo(() => {
    const hourOf = (iso: string) => Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: salon.timezone }).format(new Date(iso)));
    const label = lang === "vi" ? ["Buổi sáng", "Buổi chiều", "Buổi tối"] : ["Morning", "Afternoon", "Evening"];
    const g: [string, Slot[]][] = [[label[0], []], [label[1], []], [label[2], []]];
    for (const s of slots ?? []) {
      const h = hourOf(s.start);
      g[h < 12 ? 0 : h < 17 ? 1 : 2][1].push(s);
    }
    return g.filter(([, list]) => list.length);
  }, [slots, salon.timezone, lang]);

  return (
    <section>
      <BackButton t={t} onClick={props.onBack} />
      <p className="mb-1 inline-flex items-center gap-2 text-sm text-gold-400">
        <Scissors className="size-4" /> {props.header}
      </p>
      <h2 className="mb-4 font-display text-2xl text-cream-50">{t.chooseDate}</h2>
      <div className="-mx-5 mb-6 flex snap-x gap-2 overflow-x-auto px-5 pb-2" role="listbox" aria-label={t.chooseDate}>
        {days.map((d) => {
          const p = formatDateParts(d, lang);
          const active = d === date;
          return (
            <button
              key={d}
              role="option"
              aria-selected={active}
              onClick={() => setDate(d)}
              className={cn(
                "flex h-20 w-16 shrink-0 snap-start flex-col items-center justify-center rounded-2xl border",
                active ? "border-gold-500 bg-gold-500 text-ink-950" : "border-cream-100/10 bg-ink-900 text-cream-100",
              )}
            >
              <span className="text-xs font-medium uppercase opacity-70">{p.weekday}</span>
              <span className="text-2xl font-semibold">{p.day}</span>
              <span className="text-[11px] opacity-70">{p.month}</span>
            </button>
          );
        })}
      </div>
      <h3 className="mb-3 text-lg font-semibold text-cream-50">
        {t.chooseTime} · <span className="font-normal text-cream-100/70">{formatDateLong(date, lang)}</span>
      </h3>
      {slots === null && !failed && (
        <p className="flex items-center gap-2 py-8 text-cream-100/60">
          <Loader2 className="size-5 animate-spin" /> {t.loading}
        </p>
      )}
      {failed && <p className="py-6 text-red-200">{t.errorGeneric}</p>}
      {slots && slots.length === 0 && <p className="rounded-2xl bg-ink-900 px-5 py-6 text-cream-100/70">{t.noTimes}</p>}
      {groups.map(([label, list]) => (
        <div key={label} className="mb-5">
          <p className="mb-2 text-xs font-semibold tracking-wider text-cream-100/50 uppercase">{label}</p>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {list.map((s) => (
              <button
                key={s.start}
                onClick={() => onPick(s)}
                className={cn(
                  "h-14 rounded-xl border text-base font-semibold",
                  props.slot?.start === s.start ? "border-gold-500 bg-gold-500 text-ink-950" : "border-cream-100/12 bg-ink-900 text-cream-50 hover:border-gold-500/70",
                )}
              >
                {timeFmt.format(new Date(s.start))}
              </button>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

function ReturningCustomer({ salon, lang, t, onProfile }: { salon: PublicSalon; lang: Lang; t: Dict; onProfile: (p: Profile, token: string, phone: string) => void }) {
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"phone" | "code" | "pick">("phone");
  const [demoCode, setDemoCode] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [token, setToken] = useState("");
  const [e164, setE164] = useState("");

  async function send() {
    setBusy(true);
    setErr(undefined);
    const r = await fetch(`/api/v1/salons/${salon.slug}/verify/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, language: lang }),
    }).then((x) => x.json()).catch(() => null);
    setBusy(false);
    if (r?.ok) {
      setDemoCode(r.data.demoCode);
      setStage("code");
    } else setErr(t.errorGeneric);
  }
  async function check() {
    setBusy(true);
    setErr(undefined);
    const r = await fetch(`/api/v1/salons/${salon.slug}/verify/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, code }),
    }).then((x) => x.json()).catch(() => null);
    setBusy(false);
    if (!r?.ok) return setErr(t.errorVerify);
    const digits = phone.replace(/\D/g, "").slice(-10);
    setE164(`+1${digits}`);
    setToken(r.data.verifiedToken);
    setProfiles(r.data.profiles);
    if (r.data.profiles.length === 1) onProfile(r.data.profiles[0], r.data.verifiedToken, `+1${digits}`);
    else setStage("pick");
  }

  if (!open)
    return (
      <button onClick={() => setOpen(true)} className="flex w-full items-center gap-4 rounded-2xl border border-gold-500/40 bg-gradient-to-r from-gold-500/15 to-transparent px-5 py-5 text-left">
        <span className="flex size-12 items-center justify-center rounded-full bg-gold-500 text-ink-950">
          <RotateCcw className="size-5" />
        </span>
        <span className="flex-1">
          <span className="block text-sm text-cream-100/70">{t.returning}</span>
          <span className="block text-xl font-semibold text-cream-50">{t.returningCta}</span>
        </span>
        <ChevronRight className="size-5 text-gold-500" />
      </button>
    );

  return (
    <div className="rounded-2xl border border-gold-500/40 bg-ink-900 p-5">
      <p className="text-xl font-semibold text-cream-50">{t.returningCta}</p>
      <p className="mb-4 text-sm text-cream-100/60">{t.returningHelp}</p>
      {err && <p className="mb-3 text-sm text-red-200" role="alert">{err}</p>}
      {stage === "phone" && (
        <form className="flex flex-col gap-3 sm:flex-row" onSubmit={(e) => { e.preventDefault(); send(); }}>
          <Input type="tel" inputMode="tel" autoComplete="tel" aria-label={t.yourPhone} placeholder={t.yourPhone} value={phone} onChange={(e) => setPhone(e.target.value)} />
          <Button variant="gold" type="submit" disabled={busy || phone.replace(/\D/g, "").length < 10} className="shrink-0">
            {busy && <Loader2 className="animate-spin" />} {t.sendCode}
          </Button>
        </form>
      )}
      {stage === "code" && (
        <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); check(); }}>
          <Label htmlFor="otp" className="text-cream-100/80">{t.enterCode}</Label>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Input id="otp" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} className="text-center text-2xl tracking-[0.4em]" />
            <Button variant="gold" type="submit" disabled={busy || code.length !== 6} className="shrink-0">
              {busy && <Loader2 className="animate-spin" />} {t.verify}
            </Button>
          </div>
          {demoCode && (
            <p className="rounded-lg bg-gold-500/15 px-3 py-2 text-sm text-gold-300">
              {t.demoCode} <strong className="tracking-widest">{demoCode}</strong>
            </p>
          )}
        </form>
      )}
      {stage === "pick" && (
        <div>
          {profiles.length === 0 ? (
            <p className="text-cream-100/70">{t.noProfile}</p>
          ) : (
            <>
              <p className="mb-3 font-semibold text-cream-50">{t.whoIsBooking}</p>
              <div className="grid gap-2">
                {profiles.map((p) => (
                  <button key={p.customerId} onClick={() => onProfile(p, token, e164)} className="flex items-center justify-between rounded-xl border border-cream-100/12 px-4 py-3 text-left hover:border-gold-500">
                    <span>
                      <span className="block text-lg font-semibold text-cream-50">{p.firstName}</span>
                      {p.usualServiceName && (
                        <span className="block text-sm text-cream-100/60">
                          {t.usual}: {p.usualServiceName[lang]}
                          {p.lastVisitDate && ` · ${t.lastVisit}: ${formatDateLong(p.lastVisitDate, lang)}`}
                        </span>
                      )}
                    </span>
                    <ChevronRight className="size-5 text-gold-500" />
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
