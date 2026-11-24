import { NextResponse, type NextRequest } from "next/server";

// Custom booking domains → hosted booking page, e.g. book.tcutz-salon.com → /book/tcutz
// Configure as CUSTOM_DOMAINS="book.tcutz-salon.com=tcutz,book.other.com=other" (Phase 4: read from salons table).
function domainMap(): Map<string, string> {
  return new Map(
    (process.env.CUSTOM_DOMAINS ?? "")
      .split(",")
      .map((p) => p.trim().split("="))
      .filter((p): p is [string, string] => p.length === 2 && !!p[0] && !!p[1]),
  );
}

export function proxy(req: NextRequest) {
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
