import { NextResponse } from "next/server";

// Magic-link landing: exchanges the one-time code for a session cookie (Supabase mode only).
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  if (code) {
    const { supabaseUser } = await import("@/lib/supabase/clients");
    const sb = await supabaseUser();
    const { error } = await sb.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL("/app/today", url.origin));
  }
  return NextResponse.redirect(new URL("/login?error=link", url.origin));
}
