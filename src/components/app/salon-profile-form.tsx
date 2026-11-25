"use client";

import { useActionState, useState, useTransition } from "react";
import { Check, Copy, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/primitives";
import { resetDemoProfileAction, saveSalonProfileAction, type ProfileResult } from "@/app/app/actions";

export interface ProfileFormValues {
  name: string;
  ownerFirstName?: string;
  ownerTitleVi?: string;
  phone?: string;
  address?: string;
}

const TITLES = ["", "chị", "anh", "cô", "chú", "bà", "ông"];

export function SalonProfileForm({ initial, demo, shareLinks }: { initial: ProfileFormValues; demo: boolean; shareLinks?: { booking: string; dashboard: string } }) {
  const [state, action, pending] = useActionState<ProfileResult, FormData>(saveSalonProfileAction, null);
  const [resetState, setResetState] = useState<ProfileResult>(null);
  const [resetting, startReset] = useTransition();
  const msg = resetState ?? state;

  return (
    <div>
      <form action={action} className="grid gap-4" key={initial.name /* refresh fields after reset */}>
        <div>
          <Label htmlFor="name">Salon name</Label>
          <Input id="name" name="name" required minLength={2} maxLength={60} defaultValue={initial.name} className="text-lg font-semibold" />
        </div>
        <div className="grid gap-4 sm:grid-cols-[1fr_9rem]">
          <div>
            <Label htmlFor="ownerFirstName">Owner first name</Label>
            <Input id="ownerFirstName" name="ownerFirstName" maxLength={30} defaultValue={initial.ownerFirstName ?? ""} />
            <p className="mt-1 text-xs text-ink-400">Used in texts: “Lan will call you back.”</p>
          </div>
          <div>
            <Label htmlFor="ownerTitleVi">Vietnamese title</Label>
            <select
              id="ownerTitleVi"
              name="ownerTitleVi"
              defaultValue={initial.ownerTitleVi ?? ""}
              className="h-12 w-full rounded-xl border-2 border-ink-900/12 bg-white px-3 text-base focus:border-gold-500 focus:outline-none"
            >
              {TITLES.map((t) => (
                <option key={t} value={t}>{t || "None"}</option>
              ))}
            </select>
            <p className="mt-1 text-xs text-ink-400">“chị Lan sẽ gọi lại”</p>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="phone">Salon phone</Label>
            <Input id="phone" name="phone" type="tel" defaultValue={initial.phone ?? ""} placeholder="(612) 555-0142" />
          </div>
          <div>
            <Label htmlFor="address">Address</Label>
            <Input id="address" name="address" maxLength={120} defaultValue={initial.address ?? ""} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="gold" size="lg" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : <Check />} Save
          </Button>
          {demo && (
            <Button
              type="button"
              variant="outline"
              size="lg"
              disabled={resetting}
              onClick={() => startReset(async () => setResetState(await resetDemoProfileAction()))}
            >
              <RotateCcw /> Reset to default
            </Button>
          )}
        </div>
        {msg?.ok && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-emerald-800" role="status">{msg.message}</p>}
        {msg && !msg.ok && <p className="rounded-lg bg-red-50 px-3 py-2 text-red-800" role="alert">{msg.error}</p>}
      </form>

      {demo && (
        <div className="mt-6 rounded-xl bg-cream-100 p-4">
          <p className="font-semibold">Showing a prospect on their own phone?</p>
          <p className="mb-3 text-sm text-ink-600">
            In demo mode the name is saved in <em>this browser</em>. Send these links and their phone shows the same name.
          </p>
          {shareLinks ? (
            <div className="grid gap-2">
              <CopyLink label="Booking page" url={shareLinks.booking} />
              <CopyLink label="Owner dashboard" url={shareLinks.dashboard} />
            </div>
          ) : (
            <p className="text-sm text-ink-400">Save a custom name first to get share links.</p>
          )}
        </div>
      )}
    </div>
  );
}

function CopyLink({ label, url }: { label: string; url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <span className="w-32 shrink-0 text-sm font-medium">{label}</span>
      <Input readOnly value={url} className="h-10 text-sm" onFocus={(e) => e.currentTarget.select()} aria-label={`${label} share link`} />
      <Button
        type="button"
        variant="dark"
        size="sm"
        onClick={async () => {
          await navigator.clipboard.writeText(url).catch(() => {});
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}
