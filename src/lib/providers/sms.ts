import "server-only";

// Provider abstraction. Phase 1 ships ONLY the console provider (never sends anything).
// Twilio lands in Phase 2 behind the same interface; selecting it today fails loudly.

export interface SmsMessage {
  to: string; // E.164
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
}

/** GSM-7 → 160 chars/segment; anything else (e.g. Vietnamese diacritics) → UCS-2, 70 chars/segment. */
export function countSegments(body: string): number {
  const gsm = /^[A-Za-z0-9 @£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà^{}\\[~\]|€]*$/.test(body);
  const single = gsm ? 160 : 70;
  const multi = gsm ? 153 : 67;
  return body.length <= single ? 1 : Math.ceil(body.length / multi);
}

const outbox: (SmsMessage & { at: string })[] = [];

export class ConsoleSmsProvider implements SmsProvider {
  readonly name = "console";
  async send(msg: SmsMessage): Promise<SmsResult> {
    outbox.push({ ...msg, at: new Date().toISOString() });
    if (outbox.length > 200) outbox.shift();
    console.info(`[sms:test-mode] → ${msg.to.slice(0, -4)}•••• (${msg.category}): ${msg.body}`);
    return { status: "test_mode", segments: countSegments(msg.body) };
  }
}

export function testOutbox() {
  return [...outbox];
}

export function getSmsProvider(name: string): SmsProvider {
  if (name === "console") return new ConsoleSmsProvider();
  throw new Error(`SMS provider "${name}" is not implemented yet (Phase 2). Use SMS_PROVIDER=console.`);
}
