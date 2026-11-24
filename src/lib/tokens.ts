import { createHmac, timingSafeEqual } from "node:crypto";

// Compact signed tokens: base64url(JSON payload) + "." + base64url(HMAC-SHA256).
// Used for appointment management links and short-lived "phone verified" sessions.

export interface TokenPayload {
  typ: "manage" | "verified_phone";
  sid: string; // salon id
  sub: string; // appointment id or E.164 phone
  exp: number; // unix seconds
}

const b64 = (buf: Buffer) => buf.toString("base64url");

export function signToken(payload: TokenPayload, secret: string): string {
  const body = b64(Buffer.from(JSON.stringify(payload)));
  const sig = b64(createHmac("sha256", secret).update(body).digest());
  return `${body}.${sig}`;
}

export function verifyToken(token: string, secret: string, typ: TokenPayload["typ"], now = Date.now()): TokenPayload | null {
  const [body, sig] = token.split(".");
  if (!body || !sig || token.length > 1024) return null;
  const expected = createHmac("sha256", secret).update(body).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as TokenPayload;
    if (p.typ !== typ || typeof p.exp !== "number" || p.exp * 1000 < now) return null;
    return p;
  } catch {
    return null;
  }
}

export function hashCode(code: string, salt: string, secret: string): string {
  return createHmac("sha256", secret).update(`${salt}:${code}`).digest("hex");
}
