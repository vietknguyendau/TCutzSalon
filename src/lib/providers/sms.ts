import "server-only";

// Provider abstraction for SMS + phone-number intelligence. Swap providers without touching callers.
//  - console: never sends; logs + keeps an in-memory outbox (default, and ALWAYS used for demo salons)
//  - twilio:  real sends via REST API (see ./twilio.ts)

import { countSegments } from "./segments";
import type { LineType } from "../textback/decide";

export { countSegments };

export interface SmsMessage {
  to: string; // E.164
  from?: string; // salon's provider number (ignored when a Messaging Service is configured)
  body: string;
  category: "transactional" | "marketing" | "verification";
  salonId: string;
}
export interface SmsResult {
  status: "sent" | "test_mode" | "suppressed";
  providerMessageId?: string;
  segments: number;
}
export interface SmsProvider {
  readonly name: string;
  send(msg: SmsMessage): Promise<SmsResult>;
  /** Mobile vs landline. "unknown" when lookups are disabled or fail — callers then treat it as mobile. */
  lookupLineType(e164: string): Promise<LineType>;
}

const outbox: (SmsMessage & { at: string })[] = [];
/** Synthetic landline numbers so the demo can show the call-back path (Robert, 555-0102). */
const DEMO_LANDLINES = new Set(["+17635550102"]);

export class ConsoleSmsProvider implements SmsProvider {
  readonly name = "console";
  async send(msg: SmsMessage): Promise<SmsResult> {
    outbox.push({ ...msg, at: new Date().toISOString() });
    if (outbox.length > 200) outbox.shift();
    console.info(`[sms:test-mode] → ${msg.to.slice(0, -4)}•••• (${msg.category}): ${msg.body}`);
    return { status: "test_mode", segments: countSegments(msg.body) };
  }
  async lookupLineType(e164: string): Promise<LineType> {
    return DEMO_LANDLINES.has(e164) ? "landline" : "mobile";
  }
}

export function testOutbox() {
  return [...outbox];
}

/** Demo salons can never reach a real provider, whatever the env says. */
export async function smsProviderFor(salon: { isDemo: boolean }, configured: string): Promise<SmsProvider> {
  if (salon.isDemo || configured === "console") return new ConsoleSmsProvider();
  if (configured === "twilio") {
    const { TwilioSmsProvider } = await import("./twilio");
    return TwilioSmsProvider.fromEnv();
  }
  throw new Error(`Unknown SMS provider "${configured}"`);
}

/** @deprecated use smsProviderFor — kept for Phase 1 call sites (console only). */
export function getSmsProvider(name: string): SmsProvider {
  if (name === "console") return new ConsoleSmsProvider();
  throw new Error(`Use smsProviderFor() for provider "${name}"`);
}
