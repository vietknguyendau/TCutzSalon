"use client";

import { useEffect, useState } from "react";

/** Red "current time" line on the day calendar; re-positions every 30s. */
export function NowLine({ timezone, dayStartMin, dayEndMin, pxPerMin, date }: { timezone: string; dayStartMin: number; dayEndMin: number; pxPerMin: number; date: string }) {
  const [mins, setMins] = useState<number | null>(null);
  useEffect(() => {
    const calc = () => {
      const now = new Date();
      const d = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(now);
      if (d !== date) return setMins(null);
      const [h, m] = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: timezone }).format(now).split(":").map(Number);
      setMins(h * 60 + m);
    };
    calc();
    const id = setInterval(calc, 30_000);
    return () => clearInterval(id);
  }, [timezone, date]);
  if (mins === null || mins < dayStartMin || mins > dayEndMin) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 z-20 flex items-center" style={{ top: (mins - dayStartMin) * pxPerMin }} aria-label="Current time">
      <span className="-ml-1.5 size-3 rounded-full bg-red-600" />
      <span className="h-0.5 flex-1 bg-red-600" />
    </div>
  );
}
