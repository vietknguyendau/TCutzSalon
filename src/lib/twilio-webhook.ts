import "server-only";
import { NextResponse } from "next/server";
import { env } from "./env";
import { validTwilioSignature } from "./providers/twilio-signature";

/**
 * Parses and authenticates a Twilio webhook. Returns the form params, or a Response to send back.
 * The signature covers the exact public URL Twilio called, so NEXT_PUBLIC_APP_URL must be the
 * production origin (e.g. https://app.example.com) — not a preview URL.
 */
export async function readTwilioWebhook(req: Request): Promise<{ params: Record<string, string> } | { response: Response }> {
  const token = env().TWILIO_AUTH_TOKEN;
  if (!token) return { response: new NextResponse("Twilio not configured", { status: 503 }) };
  const form = await req.formData().catch(() => null);
  if (!form) return { response: new NextResponse("Bad request", { status: 400 }) };
  const params: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === "string") params[k] = v;
  const u = new URL(req.url);
  const publicUrl = `${env().NEXT_PUBLIC_APP_URL}${u.pathname}${u.search}`;
  if (!validTwilioSignature(token, publicUrl, params, req.headers.get("x-twilio-signature"))) {
    return { response: new NextResponse("Invalid signature", { status: 403 }) };
  }
  return { params };
}

const esc = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);

export function twiml(inner: string): Response {
  return new NextResponse(`<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`, {
    headers: { "Content-Type": "text/xml; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export const say = (text: string, lang: "en" | "vi" = "en") =>
  lang === "vi"
    ? `<Say language="vi-VN" voice="Google.vi-VN-Standard-A">${esc(text)}</Say>`
    : `<Say language="en-US" voice="Polly.Joanna">${esc(text)}</Say>`;

export const message = (text: string) => `<Message>${esc(text)}</Message>`;
