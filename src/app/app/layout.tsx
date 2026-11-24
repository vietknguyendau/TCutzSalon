import { getStaffContext } from "@/lib/auth";
import { AppNav } from "@/components/app/nav";


export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getStaffContext();
  return (
    <div className="min-h-dvh bg-cream-50 md:pl-60">
      <AppNav salonName={ctx.salon.name} demo={ctx.demo} slug={ctx.salon.slug} />
      {ctx.demo && (
        <div className="sticky top-0 z-30 bg-gold-500 px-4 py-1.5 text-center text-sm font-semibold text-ink-950" role="status">
          DEMO MODE — synthetic customers only. No real appointments, calls or texts.
        </div>
      )}
      <div className="mx-auto max-w-6xl px-4 pt-5 pb-28 sm:px-6 md:pb-12">{children}</div>
    </div>
  );
}
