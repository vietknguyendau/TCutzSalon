export function timeAgo(iso: string, now = new Date()): string {
  const mins = Math.round((now.getTime() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.round(h / 24);
  return `${d} day${d > 1 ? "s" : ""} ago`;
}

/** Start of a trailing window, e.g. daysAgo(7). Kept out of components so render stays pure. */
export function daysAgo(n: number, now = new Date()): Date {
  return new Date(now.getTime() - n * 86_400_000);
}
