import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Twilio webhook signature (X-Twilio-Signature):
 *   base64( HMAC-SHA1( authToken, fullUrl + concat(sorted POST param name+value) ) )
 * `fullUrl` must be the exact public URL Twilio called, including query string.
 */
export function twilioSignature(authToken: string, url: string, params: Record<string, string>): string {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, k) => acc + k + params[k], url);
  return createHmac("sha1", authToken).update(Buffer.from(data, "utf8")).digest("base64");
}

export function validTwilioSignature(authToken: string, url: string, params: Record<string, string>, given: string | null): boolean {
  if (!given) return false;
  const expected = Buffer.from(twilioSignature(authToken, url, params));
  const actual = Buffer.from(given);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
