import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getStore } from "@/lib/data";
import { bookingWindow } from "@/lib/booking/service";
import { BookingFlow, type PublicSalon } from "@/components/booking/booking-flow";


export async function generateMetadata(props: PageProps<"/book/[slug]">): Promise<Metadata> {
  const { slug } = await props.params;
  const store = await getStore("public");
  const salon = await store.getSalonBySlug(slug);
  return { title: salon ? `Book · ${salon.name}` : "Book" };
}

export default async function BookPage(props: PageProps<"/book/[slug]">) {
  const { slug } = await props.params;
  const sp = await props.searchParams;
  const store = await getStore("public");
  const salon = await store.getSalonBySlug(slug);
  if (!salon) notFound();
  const [services, staff] = await Promise.all([store.listServices(salon.id), store.listStaff(salon.id)]);

  // Only public, non-sensitive fields cross to the browser.
  const pub: PublicSalon = {
    slug: salon.slug,
    name: salon.name,
    phone: salon.phone,
    address: salon.address,
    timezone: salon.timezone,
    isDemo: salon.isDemo,
    window: bookingWindow(salon),
    services: services
      .filter((s) => s.isActive && s.onlineBookable)
      .map((s) => ({
        id: s.id,
        nameEn: s.nameEn,
        nameVi: s.nameVi,
        priceCents: s.priceCents,
        priceType: s.priceType,
        durationMinutes: s.durationMinutes,
        requiresApproval: s.requiresApproval,
      })),
    staff: staff
      .filter((s) => s.isActive && s.isBookableOnline)
      .map((s) => ({ id: s.id, name: s.displayName, serviceIds: s.services.map((l) => l.serviceId) })),
  };
  const lang = sp.lang === "vi" || sp.lang === "en" ? sp.lang : undefined;
  return <BookingFlow salon={pub} initialLang={lang} />;
}
