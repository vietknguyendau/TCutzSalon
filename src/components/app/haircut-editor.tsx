"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { Camera, Check, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/primitives";
import { addPhotoAction, recordPhotoConsentAction, saveHaircutAction, type ActionResult } from "@/app/app/actions";
import type { HaircutProfile } from "@/lib/domain/types";

const FIELDS: [keyof HaircutProfile, string, string?][] = [
  ["style", "Style", "e.g. Low skin fade, textured crop"],
  ["clipperGuard", "Clipper guard", "e.g. 0 → 2, blend to 4"],
  ["fadeType", "Fade type"],
  ["topLength", "Top length"],
  ["sideLength", "Side length"],
  ["backLength", "Back length"],
  ["hairline", "Hairline / neckline"],
  ["beard", "Beard"],
  ["scissorNotes", "Scissor notes"],
  ["colorFormula", "Color formula"],
  ["products", "Products used"],
];

export function HaircutEditor({ customerId, profile }: { customerId: string; profile: HaircutProfile | null }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(saveHaircutAction, null);
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="customerId" value={customerId} />
      <div className="grid gap-3 sm:grid-cols-2">
        {FIELDS.map(([k, label, ph]) => (
          <div key={k}>
            <Label htmlFor={k}>{label}</Label>
            <Input id={k} name={k} defaultValue={(profile?.[k] as string) ?? ""} placeholder={ph} maxLength={300} />
          </div>
        ))}
      </div>
      <div>
        <Label htmlFor="stylistNotes">Stylist notes</Label>
        <Textarea id="stylistNotes" name="stylistNotes" defaultValue={profile?.stylistNotes ?? ""} maxLength={1000} />
      </div>
      <div>
        <Label htmlFor="customerFeedback">Customer feedback today (optional)</Label>
        <Input id="customerFeedback" name="customerFeedback" maxLength={500} placeholder="e.g. Loved it, a bit shorter next time" />
      </div>
      <Button type="submit" variant="dark" size="lg" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : <Check />} Save today&apos;s cut
      </Button>
      <p className="text-sm text-ink-400">Saving updates the current preferences and adds a dated entry to the history — old entries are never overwritten.</p>
      {state?.ok && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-emerald-800" role="status">Saved to history.</p>}
      {state && !state.ok && <p className="rounded-lg bg-red-50 px-3 py-2 text-red-800" role="alert">{state.error}</p>}
    </form>
  );
}

async function downscale(file: File, max = 1000): Promise<string> {
  const img = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.78);
}

export function PhotoCapture({ customerId, consent }: { customerId: string; consent: boolean }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string>();
  const [angle, setAngle] = useState<"front" | "side" | "back">("front");
  const input = useRef<HTMLInputElement>(null);

  if (!consent)
    return (
      <div className="rounded-xl border-2 border-dashed border-ink-900/15 p-4">
        <p className="mb-3 text-[15px] text-ink-700">Photos are optional and private. Ask the customer first, then record their permission.</p>
        <Button variant="outline" disabled={pending} onClick={() => start(async () => { await recordPhotoConsentAction(customerId, true); })}>
          <ShieldCheck /> Customer said yes to photos
        </Button>
      </div>
    );

  return (
    <div>
      <div className="mb-3 flex gap-2">
        {(["front", "side", "back"] as const).map((a) => (
          <button key={a} onClick={() => setAngle(a)} className={`h-11 rounded-xl border-2 px-4 font-semibold capitalize ${angle === a ? "border-gold-500 bg-gold-300/30" : "border-ink-900/10 bg-white"}`}>
            {a}
          </button>
        ))}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        aria-label="Take photo"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          start(async () => {
            setErr(undefined);
            try {
              const r = await addPhotoAction({ customerId, angle, dataUrl: await downscale(f) });
              if (!r.ok) setErr(r.error);
            } catch {
              setErr("Could not read that photo.");
            }
            e.target.value = "";
          });
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="gold" size="lg" disabled={pending} onClick={() => input.current?.click()}>
          {pending ? <Loader2 className="animate-spin" /> : <Camera />} Take {angle} photo
        </Button>
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => start(async () => { await recordPhotoConsentAction(customerId, false); })}>
          Withdraw permission
        </Button>
      </div>
      {err && <p className="mt-2 text-sm text-red-700" role="alert">{err}</p>}
    </div>
  );
}
