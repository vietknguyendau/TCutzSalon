import "server-only";
// Twilio over plain REST (no SDK → smaller bundle, nothing to keep patched).
// NOT exercised against live Twilio from this build environment — see IMPLEMENTATION_STATUS.md.

import type { LineType } from "../textback/decide";
import { countSegments } from "./segments";
import type { SmsMessage, SmsProvider, SmsResult } from "./sms";

export class TwilioSmsProvider implements SmsProvider {
  readonly name = "twilio";
  constructor(
    private accountSid: string,
    private authToken: string,
    private messagingServiceSid: string | undefined,
    private lineLookup: boolean,
    private statusCallbackUrl: string | undefined,
  ) {}

  static fromEnv(): TwilioSmsProvider {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    if (!sid || !token) throw new Error("TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are required for SMS_PROVIDER=twilio");
    const app = process.env.NEXT_PUBLIC_APP_URL;
    return new TwilioSmsProvider(
      sid,
      token,
      process.env.TWILIO_MESSAGING_SERVICE_SID || undefined,
      process.env.TWILIO_LINE_LOOKUP !== "off",
      app ? `${app}/api/webhooks/twilio/sms-status` : undefined,
    );
  }

  private auth() {
    return `Basic ${Buffer.from(`${this.accountSid}:${this.authToken}`).toString("base64")}`;
  }

  async send(msg: SmsMessage): Promise<SmsResult> {
    const form = new URLSearchParams({ To: msg.to, Body: msg.body });
    // A Messaging Service (registered for A2P 10DLC) is the right way to send in the US.
    if (this.messagingServiceSid) form.set("MessagingServiceSid", this.messagingServiceSid);
    else if (msg.from) form.set("From", msg.from);
    else throw new Error("No sender: set TWILIO_MESSAGING_SERVICE_SID or the salon's provider number");
    if (this.statusCallbackUrl) form.set("StatusCallback", this.statusCallbackUrl);

    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`, {
      method: "POST",
      headers: { Authorization: this.auth(), "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json().catch(() => ({}))) as { sid?: string; code?: number; message?: string };
    if (!res.ok) {
      // 21610 = recipient replied STOP (Twilio blocks it) → treat as suppressed, not an error.
      if (json.code === 21610) return { status: "suppressed", segments: 0 };
      throw new Error(`Twilio send failed (${res.status} ${json.code ?? ""}): ${json.message ?? "unknown"}`);
    }
    return { status: "sent", providerMessageId: json.sid, segments: countSegments(msg.body) };
  }

  /** Lookup v2 Line Type Intelligence (billed per lookup). */
  async lookupLineType(e164: string): Promise<LineType> {
    if (!this.lineLookup) return "unknown";
    try {
      const res = await fetch(`https://lookups.twilio.com/v2/PhoneNumbers/${encodeURIComponent(e164)}?Fields=line_type_intelligence`, {
        headers: { Authorization: this.auth() },
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) return "unknown";
      const j = (await res.json()) as { line_type_intelligence?: { type?: string } };
      const t = j.line_type_intelligence?.type;
      if (t === "landline" || t === "fixedVoip") return "landline";
      if (t === "mobile") return "mobile";
      if (t === "nonFixedVoip") return "voip";
      return "unknown";
    } catch {
      return "unknown";
    }
  }
}
