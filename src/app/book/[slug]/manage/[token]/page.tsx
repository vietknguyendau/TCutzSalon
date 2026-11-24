import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { CalendarX2, Check } from "lucide-react";
import { getStore } from "@/lib/data";
import { cancelByCustomer, readManageToken } from "@/lib/booking/service";
import { dict, formatDateLong } from "@/lib/i18n/dict";
import { formatLocalTime, localDateOf } from "@/lib/scheduling/time";
import { formatPrice } from "@/lib/money";
import { formatPhoneUS } from "@/lib/phone";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Manage appointment", robots: { index: false } };

async function load(token: string) {
  await connection(); // token expiry depends on the current time → request-time only
  const t = readManageToken(token);
  if (!t) return null;
  const store = await getStore("public");
  const salon = await store.getSalonById(t.sid);
  const appt = salon ? await store.getAppointment(salon.id, t.sub) : null;
  if (!salon || !appt) return null;
  const customer = appt.customerId ? await store.getCustomer(salon.id, appt.customerId) : null;
  return { store, salon, appt, lang: customer?.preferredLanguage ?? "en" };
}

export default async function ManagePage(props: PageProps<"/book/[slug]/manage/[token]">) {
  const { token, slug } = await props.params;
  const sp = await props.searchParams;
  const found = await load(token);
  const lang = sp.lang === "vi" ? "vi" : sp.lang === "en" ? "en" : (found?.lang ?? "en");
  const t = dict[lang];

  async function cancel() {
    "use server";
    const f = await load(token);
    if (!f) return;
    await cancelByCustomer(f.store, f.salon, f.appt.id);
    revalidatePath(`/book/${slug}/manage/${token}`);
    redirect(`/book/${slug}/manage/${token}?done=1`);
  }

  return (
    <div className="min-h-dvh bg-ink-950 px-5 py-10 text-cream-100">
      <div className="mx-auto max-w-lg">
        {!found ? (
          <p className="rounded-2xl bg-ink-900 p-6 text-lg">{t.linkInvalid}</p>
        ) : (
          <>
            {found.salon.isDemo && <p className="mb-4 rounded-lg bg-gold-500 px-3 py-2 text-center text-sm font-semibold text-ink-950">{t.demoBanner}</p>}
            <p className="text-xs tracking-[0.2em] text-gold-500 uppercase">{found.salon.name}</p>
            <h1 className="mb-6 font-display text-3xl text-cream-50">{t.manageTitle}</h1>
            <div className="rounded-2xl border border-cream-100/10 bg-ink-900 p-6">
              <p className="text-xl font-semibold text-cream-50">{found.appt.services.map((s) => s.name).join(" + ")}</p>
              <p className="mt-1 text-lg text-cream-100/80">
                {formatDateLong(localDateOf(found.appt.startsAt, found.salon.timezone), lang)} ·{" "}
                {formatLocalTime(found.appt.startsAt, found.salon.timezone, lang)}
              </p>
              <p className="mt-1 text-cream-100/60">
                {formatPrice(found.appt.estimatedPriceCents, found.appt.services[0]?.priceType)}
              </p>
            </div>
            {found.appt.status === "canceled" ? (
              <p className="mt-6 flex items-center gap-2 text-lg text-gold-300">
                <Check className="size-5" /> {t.canceled}
              </p>
            ) : new Date(found.appt.startsAt) < new Date() ? (
              <p className="mt-6 text-cream-100/70">{t.pastAppt}</p>
            ) : (
              <form action={cancel} className="mt-6">
                {/* Two-step cancel without JavaScript: reveal, then confirm. */}
                <details className="group">
                  <summary className="flex h-14 cursor-pointer list-none items-center justify-center gap-2 rounded-xl border-2 border-red-400/50 text-lg font-semibold text-red-200 group-open:hidden">
                    <CalendarX2 className="size-5" /> {t.cancelAppt}
                  </summary>
                  <Button variant="danger" size="lg" className="w-full" type="submit">
                    <CalendarX2 /> {t.cancelConfirm}
                  </Button>
                </details>
                <p className="mt-3 text-center text-sm text-cream-100/60">
                  {lang === "vi" ? "Muốn đổi giờ? Gọi" : "Need a different time? Cancel and rebook, or call"}{" "}
                  <a className="text-gold-400 underline" href={`tel:${found.salon.phone}`}>
                    {formatPhoneUS(found.salon.phone)}
                  </a>
                </p>
              </form>
            )}
            <a href={`/book/${found.salon.slug}?lang=${lang}`} className="mt-8 block text-center text-gold-400 underline">
              {t.bookAnother}
            </a>
          </>
        )}
      </div>
    </div>
  );
}
