import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Phone, Repeat2 } from "lucide-react";
import { getStaffContext } from "@/lib/auth";
import { formatPhoneUS } from "@/lib/phone";
import { formatMoney, formatPrice } from "@/lib/money";
import { formatLocalTime, localDateOf } from "@/lib/scheduling/time";
import { formatDateLong } from "@/lib/i18n/dict";
import { Card, Pill, SOURCE_LABEL, StatusBadge } from "@/components/ui/primitives";
import { buttonVariants } from "@/components/ui/button";
import { HaircutEditor, PhotoCapture } from "@/components/app/haircut-editor";
import type { HaircutHistoryEntry } from "@/lib/domain/types";

export const metadata = { title: "Customer" };

const LABELS: Record<string, string> = {
  style: "Style", clipperGuard: "Guard", fadeType: "Fade", topLength: "Top", sideLength: "Sides", backLength: "Back",
  hairline: "Hairline", beard: "Beard", scissorNotes: "Scissor", colorFormula: "Color", products: "Products", stylistNotes: "Notes",
};

export default async function CustomerPage(props: PageProps<"/app/customers/[id]">) {
  const { id } = await props.params;
  const ctx = await getStaffContext();
  const { store, salon } = ctx;
  const c = await store.getCustomer(salon.id, id);
  if (!c) notFound();
  const [profile, history, appts, services, staff, household] = await Promise.all([
    store.getHaircutProfile(salon.id, id),
    store.listHaircutHistory(salon.id, id),
    store.listCustomerAppointments(salon.id, id),
    store.listServices(salon.id),
    store.listStaff(salon.id),
    c.phoneE164 ? store.findCustomersByPhone(salon.id, c.phoneE164) : Promise.resolve([]),
  ]);
  const usual = services.find((s) => s.id === c.usualServiceId);
  const pref = staff.find((s) => s.id === c.preferredStaffId);
  const others = household.filter((h) => h.id !== c.id);
  const intervalDays =
    c.firstVisitAt && c.lastVisitAt && c.completedVisits > 1
      ? Math.round((Date.parse(c.lastVisitAt) - Date.parse(c.firstVisitAt)) / 86_400_000 / (c.completedVisits - 1))
      : undefined;
  const noShows = appts.filter((a) => a.status === "no_show").length;
  const cancels = appts.filter((a) => a.status === "canceled").length;

  return (
    <div>
      <Link href="/app/customers" className="mb-4 inline-flex h-11 items-center gap-1.5 text-ink-600"><ArrowLeft className="size-5" /> Customers</Link>
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-display text-3xl sm:text-4xl">{c.firstName} {c.lastName}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-ink-600">
            {c.phoneE164 && <a href={`tel:${c.phoneE164}`} className="inline-flex items-center gap-1 font-medium text-ink-900"><Phone className="size-4" /> {formatPhoneUS(c.phoneE164)}</a>}
            <Pill>{c.preferredLanguage === "vi" ? "Tiếng Việt" : "English"}</Pill>
            {pref && <Pill>Prefers {pref.displayName}</Pill>}
            {c.isSynthetic && <Pill className="bg-gold-300/60">Synthetic demo profile</Pill>}
          </p>
          {others.length > 0 && (
            <p className="mt-2 text-sm text-ink-600">
              Shares phone with:{" "}
              {others.map((o, i) => (
                <span key={o.id}>{i > 0 && ", "}<Link href={`/app/customers/${o.id}`} className="font-medium underline">{o.firstName}</Link></span>
              ))}
            </p>
          )}
        </div>
        <Link href={`/app/today?book=${c.id}`} className={buttonVariants({ variant: "gold", size: "lg", className: "shrink-0" })}>
          <Repeat2 /> Same as last time
        </Link>
      </header>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Fact label="Visits" value={String(c.completedVisits)} />
        <Fact label="Lifetime spend" value={formatMoney(c.lifetimeSpendCents)} />
        <Fact label="Usually every" value={intervalDays ? `${intervalDays} days` : "—"} />
        <Fact label="Last visit" value={c.lastVisitAt ? formatDateLong(localDateOf(c.lastVisitAt, salon.timezone), "en") : "—"} />
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-xl font-semibold">How they like it</h2>
              {usual && <Pill>Usual: {usual.nameEn} · {formatPrice(usual.priceCents, usual.priceType)}</Pill>}
            </div>
            {profile ? (
              <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                {Object.entries(LABELS).map(([k, label]) => {
                  const v = profile[k as keyof typeof profile];
                  return v ? (
                    <div key={k} className={k === "stylistNotes" ? "sm:col-span-2" : ""}>
                      <dt className="text-xs font-semibold tracking-wide text-ink-400 uppercase">{label}</dt>
                      <dd className="text-[17px] font-medium text-ink-950">{v}</dd>
                    </div>
                  ) : null;
                })}
              </dl>
            ) : (
              <p className="text-ink-600">No haircut notes yet. Add them below after the cut.</p>
            )}
          </Card>

          <Card className="p-5">
            <h2 className="mb-3 text-xl font-semibold">Record today&apos;s cut</h2>
            <HaircutEditor customerId={c.id} profile={profile} />
          </Card>

          <Card className="p-5">
            <h2 className="mb-3 text-xl font-semibold">Photos</h2>
            <PhotoCapture customerId={c.id} consent={c.photoConsent} />
          </Card>
        </div>

        <div className="space-y-6 lg:col-span-2">
          <Card className="p-5">
            <h2 className="mb-4 text-xl font-semibold">Haircut history</h2>
            {history.length === 0 ? <p className="text-ink-600">No history yet.</p> : <Timeline history={history} staff={staff.map((s) => ({ id: s.id, name: s.displayName }))} />}
          </Card>
          <Card className="p-5">
            <h2 className="mb-1 text-xl font-semibold">Appointments</h2>
            <p className="mb-3 text-sm text-ink-400">{cancels} canceled · {noShows} no-shows</p>
            <ul className="divide-y divide-ink-900/8">
              {appts.slice(0, 12).map((a) => (
                <li key={a.id}>
                  <Link href={`/app/appointments/${a.id}`} className="flex items-center justify-between gap-2 py-2.5">
                    <span>
                      <span className="block font-medium">{formatDateLong(localDateOf(a.startsAt, salon.timezone), "en")} · {formatLocalTime(a.startsAt, salon.timezone)}</span>
                      <span className="text-sm text-ink-400">{a.services.map((s) => s.name).join(" + ")} · {SOURCE_LABEL[a.source]}</span>
                    </span>
                    <StatusBadge status={a.status} />
                  </Link>
                </li>
              ))}
              {appts.length === 0 && <li className="py-2 text-ink-600">No appointments recorded in this system yet.</li>}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-4">
      <p className="text-sm text-ink-400">{label}</p>
      <p className="text-lg font-bold">{value}</p>
    </Card>
  );
}

function Timeline({ history, staff }: { history: HaircutHistoryEntry[]; staff: { id: string; name: string }[] }) {
  return (
    <ol className="relative space-y-5 border-l-2 border-gold-500/40 pl-5">
      {history.map((h) => (
        <li key={h.id} className="relative">
          <span className="absolute top-1.5 -left-[27px] size-3 rounded-full border-2 border-white bg-gold-500" />
          <p className="font-semibold">
            {formatDateLong(h.cutOn, "en")}
            {h.staffId && <span className="font-normal text-ink-400"> · {staff.find((s) => s.id === h.staffId)?.name}</span>}
          </p>
          <p className="text-[15px] text-ink-700">{[h.snapshot.style, h.snapshot.clipperGuard, h.snapshot.topLength && `top ${h.snapshot.topLength}`, h.snapshot.colorFormula].filter(Boolean).join(" · ")}</p>
          {h.customerFeedback && <p className="mt-0.5 text-sm text-ink-600 italic">“{h.customerFeedback}”</p>}
          {h.photos.length > 0 && (
            <div className="mt-2 flex gap-2">
              {h.photos.map((p) => (
                // eslint-disable-next-line @next/next/no-img-element -- private data-URL / signed URL, not optimizable
                <img key={p.id} src={p.url} alt={`${p.angle} view`} className="size-20 rounded-lg object-cover" />
              ))}
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}
