import { getStaffContext } from "@/lib/auth";
import { formatPrice } from "@/lib/money";
import { Card, Pill } from "@/components/ui/primitives";

export const metadata = { title: "Services" };

export default async function ServicesPage() {
  const ctx = await getStaffContext();
  const [services, staff] = await Promise.all([ctx.store.listServices(ctx.salon.id), ctx.store.listStaff(ctx.salon.id)]);
  return (
    <div>
      <h1 className="font-display text-3xl">Services</h1>
      <p className="mb-5 rounded-xl bg-gold-300/40 px-4 py-3 text-ink-800">
        Prices are from the salon&apos;s advertised menu. <strong>Durations are provisional</strong> and need {ctx.salon.ownerFirstName ?? "the owner"}&apos;s approval before launch.
      </p>
      <Card className="divide-y divide-ink-900/8">
        {services.map((s) => {
          const who = staff.filter((st) => st.services.some((l) => l.serviceId === s.id));
          return (
            <div key={s.id} className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center">
              <div className="flex-1">
                <p className="text-lg font-semibold">{s.nameEn} <span className="font-normal text-ink-400">· {s.nameVi}</span></p>
                <p className="flex flex-wrap gap-1.5 pt-1">
                  <Pill>{s.durationMinutes} min</Pill>
                  {s.cleanupMinutes > 0 && <Pill>+{s.cleanupMinutes} min cleanup</Pill>}
                  {s.requiresApproval && <Pill className="bg-amber-100 text-amber-900">Owner approval</Pill>}
                  {!s.aiBookable && <Pill>Not bookable by AI</Pill>}
                  {who.map((w) => (
                    <Pill key={w.id}>
                      <span className="size-2 rounded-full" style={{ background: w.color }} /> {w.displayName}
                      {w.services.find((l) => l.serviceId === s.id)?.durationOverrideMinutes && ` (${w.services.find((l) => l.serviceId === s.id)!.durationOverrideMinutes}m)`}
                    </Pill>
                  ))}
                </p>
              </div>
              <p className="font-display text-2xl">{formatPrice(s.priceCents, s.priceType)}</p>
            </div>
          );
        })}
      </Card>
      <p className="mt-4 text-sm text-ink-400">Editing services in the app is the next Phase 1 milestone. Until then, changes are made in the seed/config.</p>
    </div>
  );
}
