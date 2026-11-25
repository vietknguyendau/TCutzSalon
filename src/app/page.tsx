import Link from "next/link";
import { CalendarCheck, PhoneCall, Scissors } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="min-h-dvh bg-ink-950 text-cream-100">
      <div className="mx-auto flex max-w-4xl flex-col px-6 py-16 sm:py-24">
        <p className="text-xs font-semibold tracking-[0.25em] text-gold-500 uppercase">Chair · salon appointments</p>
        <h1 className="mt-4 font-display text-5xl leading-[1.05] text-cream-50 sm:text-7xl">
          Keep cutting hair.
          <br />
          <span className="text-gold-400">We&apos;ll handle the appointments.</span>
        </h1>
        <p className="mt-6 max-w-xl text-lg text-cream-100/70">
          A digital appointment book, haircut memory for every regular, and English &amp; Vietnamese booking that works for customers who&apos;d rather not download anything.
        </p>
        <div className="mt-10 flex flex-col gap-3 sm:flex-row">
          <Link href="/app/today" className={buttonVariants({ variant: "gold", size: "lg" })}>Open the demo dashboard</Link>
          <Link href="/book/demo" className={buttonVariants({ variant: "outline", size: "lg", className: "border-cream-100/20 bg-transparent text-cream-50" })}>
            See customer booking
          </Link>
        </div>
        <div className="mt-20 grid gap-6 sm:grid-cols-3">
          {[
            [CalendarCheck, "Paper calendar, replaced", "Today's chair at a glance. Arrived, in chair, done — one tap each."],
            [Scissors, "Remembers every cut", "Guard numbers, fades, color formulas, photos with permission. “Same as last time” in one tap."],
            [PhoneCall, "Answers the phone (soon)", "A bilingual AI receptionist books into the same calendar — tested in Vietnamese before it goes live."],
          ].map(([Icon, title, body]) => {
            const I = Icon as typeof CalendarCheck;
            return (
              <div key={title as string}>
                <I className="mb-3 size-6 text-gold-500" />
                <p className="text-lg font-semibold text-cream-50">{title as string}</p>
                <p className="mt-1 text-cream-100/60">{body as string}</p>
              </div>
            );
          })}
        </div>
      </div>
    </main>
  );
}
