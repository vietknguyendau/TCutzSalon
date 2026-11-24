import Link from "next/link";
import { ChevronRight, Search } from "lucide-react";
import { getStaffContext } from "@/lib/auth";
import { formatPhoneUS } from "@/lib/phone";
import { formatMoney } from "@/lib/money";
import { Card, Input, Pill } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { localDateOf } from "@/lib/scheduling/time";

export const metadata = { title: "Customers" };

export default async function CustomersPage(props: PageProps<"/app/customers">) {
  const ctx = await getStaffContext();
  const sp = await props.searchParams;
  const q = typeof sp.q === "string" ? sp.q.slice(0, 60) : "";
  const [list, services] = await Promise.all([ctx.store.searchCustomers(ctx.salon.id, q), ctx.store.listServices(ctx.salon.id)]);
  // Group household members who share a phone.
  const phoneCounts = list.reduce<Record<string, number>>((m, c) => (c.phoneE164 ? ((m[c.phoneE164] = (m[c.phoneE164] ?? 0) + 1), m) : m), {});

  return (
    <div>
      <h1 className="mb-4 font-display text-3xl">Customers</h1>
      <form className="mb-5 flex gap-2" role="search">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-ink-400" />
          <Input name="q" defaultValue={q} placeholder="Search by name or phone" className="pl-11" />
        </div>
        <Button type="submit" variant="dark">Search</Button>
      </form>
      <Card className="divide-y divide-ink-900/8">
        {list.length === 0 && <p className="p-6 text-ink-600">No customers match “{q}”.</p>}
        {list.map((c) => {
          const usual = services.find((s) => s.id === c.usualServiceId);
          return (
            <Link key={c.id} href={`/app/customers/${c.id}`} className="flex items-center gap-4 px-4 py-4 hover:bg-cream-100">
              <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-ink-900 font-display text-lg text-gold-400">
                {c.firstName[0]}
                {c.lastName?.[0]}
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-lg font-semibold">
                  {c.firstName} {c.lastName}
                  {c.preferredLanguage === "vi" && <Pill>Tiếng Việt</Pill>}
                  {c.phoneE164 && phoneCounts[c.phoneE164] > 1 && <Pill className="bg-gold-300/50">Shared phone</Pill>}
                </p>
                <p className="text-sm text-ink-600">
                  {formatPhoneUS(c.phoneE164)} · {usual?.nameEn ?? "—"} · {c.completedVisits} visits · {formatMoney(c.lifetimeSpendCents)}
                  {c.lastVisitAt && ` · last ${localDateOf(c.lastVisitAt, ctx.salon.timezone)}`}
                </p>
              </div>
              <ChevronRight className="size-5 text-ink-300" />
            </Link>
          );
        })}
      </Card>
    </div>
  );
}
