import type { PriceType } from "./domain/types";

export function formatPrice(cents: number, type: PriceType = "fixed"): string {
  const dollars = cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
  return type === "starting_at" ? `${dollars}+` : dollars;
}

export function formatMoney(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100);
}
