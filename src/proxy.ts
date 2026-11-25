import { NextResponse, type NextRequest } from "next/server";
import { DEMO_BRAND_COOKIE, DEMO_BRAND_PARAM, decodeProfile } from "./lib/salon-profile";

// Custom booking domains → hosted booking page, e.g. book.yoursalon.com → /book/yoursalon
// Configure as CUSTOM_DOMAINS="book.yoursalon.com=yoursalon,book.other.com=other" (Phase 4: read from salons table).
function domainMap(): Map<string, string> {
  return new Map(
    (process.env.CUSTOM_DOMAINS ?? "")
      .split(",")
      .map((p) => p.trim().split("="))
      .filter((p): p is [string, string] => p.length === 2 && !!p[0] && !!p[1]),
  );
}

export function proxy(req: NextRequest) {
  // Demo share links: ?brand=<profile> stores the prospect's salon name in this browser, then drops the param.
  const brand = req.nextUrl.searchParams.get(DEMO_BRAND_PARAM);
  if (brand !== null && (process.env.DATA_MODE ?? "demo") === "demo") {
    const url = req.nextUrl.clone();
    url.searchParams.delete(DEMO_BRAND_PARAM);
    const res = NextResponse.redirect(url);
    if (decodeProfile(brand)) {
      res.cookies.set(DEMO_BRAND_COOKIE, brand, { httpOnly: true, sameSite: "lax", secure: req.nextUrl.protocol === "https:", path: "/", maxAge: 60 * 60 * 24 * 180 });
    }
    return res;
  }

  const host = req.headers.get("host")?.split(":")[0]?.toLowerCase() ?? "";
  const slug = domainMap().get(host);
  const { pathname } = req.nextUrl;
  if (slug && !pathname.startsWith("/book/") && !pathname.startsWith("/api/") && !pathname.startsWith("/_next/")) {
    const url = req.nextUrl.clone();
    url.pathname = pathname === "/" ? `/book/${slug}` : `/book/${slug}${pathname}`;
    return NextResponse.rewrite(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|icon.svg|manifest.webmanifest).*)"],
};
