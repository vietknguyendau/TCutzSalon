import { redirect } from "next/navigation";
import { isDemoMode } from "@/lib/data";
import { env } from "@/lib/env";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/primitives";

export const metadata = { title: "Sign in" };

export default async function LoginPage(props: PageProps<"/login">) {
  if (isDemoMode()) redirect("/app/today");
  const sp = await props.searchParams;

  async function sendLink(form: FormData) {
    "use server";
    const email = String(form.get("email") ?? "").trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) redirect("/login?error=email");
    const { supabaseUser } = await import("@/lib/supabase/clients");
    const sb = await supabaseUser();
    // shouldCreateUser: false → only invited staff can sign in.
    await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: `${env().NEXT_PUBLIC_APP_URL}/auth/callback` } });
    redirect("/login?sent=1");
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-ink-950 px-5">
      <form action={sendLink} className="w-full max-w-sm rounded-3xl bg-cream-50 p-7">
        <h1 className="mb-1 font-display text-3xl">Sign in</h1>
        <p className="mb-5 text-ink-600">We&apos;ll email you a sign-in link.</p>
        {sp.sent && <p className="mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-emerald-800">If that email belongs to a staff member, a link is on its way.</p>}
        {sp.error === "no_salon" && <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-amber-900">Your account isn&apos;t linked to a salon yet.</p>}
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
        <Button type="submit" variant="dark" size="lg" className="mt-4 w-full">Email me a link</Button>
      </form>
    </main>
  );
}
