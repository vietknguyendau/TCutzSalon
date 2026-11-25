/** GSM-7 → 160 chars/segment; anything else (e.g. Vietnamese diacritics) → UCS-2, 70 chars/segment. */
export function countSegments(body: string): number {
  const gsm = /^[A-Za-z0-9 @£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà^{}\\[~\]|€]*$/.test(body);
  const single = gsm ? 160 : 70;
  const multi = gsm ? 153 : 67;
  return body.length <= single ? 1 : Math.ceil(body.length / multi);
}
