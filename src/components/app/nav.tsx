"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { BarChart3, CalendarDays, ExternalLink, Menu, PhoneCall, Scissors, Settings, Sun, Users, UsersRound, X } from "lucide-react";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/app/today", label: "Today", icon: Sun, primary: true },
  { href: "/app/calendar", label: "Calendar", icon: CalendarDays, primary: true },
  { href: "/app/customers", label: "Customers", icon: Users, primary: true },
  { href: "/app/services", label: "Services", icon: Scissors },
  { href: "/app/staff", label: "Staff", icon: UsersRound },
  { href: "/app/receptionist", label: "Phone & texts", icon: PhoneCall },
  { href: "/app/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/app/settings", label: "Settings", icon: Settings },
];

export function AppNav({ salonName, demo, slug }: { salonName: string; demo: boolean; slug: string }) {
  const path = usePathname();
  const [more, setMore] = useState(false);
  const active = (href: string) => path === href || path.startsWith(`${href}/`);

  return (
    <>
      {/* Tablet / desktop rail */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col bg-ink-950 text-cream-100 md:flex">
        <div className="px-5 pt-6 pb-5">
          <p className="text-[11px] font-semibold tracking-[0.22em] text-gold-500 uppercase">{demo ? "Demo salon" : "Salon"}</p>
          <p className="mt-1 font-display text-xl leading-tight text-cream-50">{salonName}</p>
        </div>
        <nav className="flex-1 space-y-1 px-3" aria-label="Main">
          {ITEMS.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex h-12 items-center gap-3 rounded-xl px-3 text-[15px] font-medium",
                active(href) ? "bg-gold-500 text-ink-950" : "text-cream-100/75 hover:bg-cream-100/8 hover:text-cream-50",
              )}
            >
              <Icon className="size-5" /> {label}
            </Link>
          ))}
        </nav>
        <Link href={`/book/${slug}`} target="_blank" className="m-3 flex h-11 items-center gap-2 rounded-xl px-3 text-sm text-cream-100/60 hover:text-cream-50">
          <ExternalLink className="size-4" /> Public booking page
        </Link>
      </aside>

      {/* Phone bottom bar */}
      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-ink-900/10 bg-white pb-[env(safe-area-inset-bottom)] md:hidden" aria-label="Main">
        {ITEMS.filter((i) => i.primary).map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} className={cn("flex h-16 flex-col items-center justify-center gap-1 text-xs font-semibold", active(href) ? "text-ink-950" : "text-ink-400")}>
            <Icon className={cn("size-6", active(href) && "text-gold-600")} /> {label}
          </Link>
        ))}
        <button onClick={() => setMore(true)} className="flex h-16 flex-col items-center justify-center gap-1 text-xs font-semibold text-ink-400">
          <Menu className="size-6" /> More
        </button>
      </nav>
      {more && (
        <div className="fixed inset-0 z-50 bg-ink-950/50 md:hidden" onClick={() => setMore(false)}>
          <div className="absolute inset-x-0 bottom-0 rounded-t-3xl bg-white p-4 pb-8" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between px-2">
              <p className="font-display text-lg">{salonName}</p>
              <button onClick={() => setMore(false)} className="flex size-11 items-center justify-center rounded-full hover:bg-ink-900/5" aria-label="Close">
                <X className="size-5" />
              </button>
            </div>
            {ITEMS.filter((i) => !i.primary).map(({ href, label, icon: Icon }) => (
              <Link key={href} href={href} onClick={() => setMore(false)} className="flex h-14 items-center gap-3 rounded-xl px-3 text-base font-medium hover:bg-ink-900/5">
                <Icon className="size-5 text-gold-600" /> {label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
