/** Normalizes US phone input to E.164 (+1XXXXXXXXXX). Returns null if it isn't a plausible US number. */
export function toE164US(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (ten.length !== 10) return null;
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(ten)) return null;
  return `+1${ten}`;
}

export function formatPhoneUS(e164?: string | null): string {
  if (!e164) return "";
  const d = e164.replace(/\D/g, "").slice(-10);
  if (d.length !== 10) return e164;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

/** "(•••) •••-0101" — for confirmations that must not reveal the full number. */
export function maskPhone(e164?: string | null): string {
  if (!e164) return "";
  return `(•••) •••-${e164.slice(-4)}`;
}
