import type { Money } from "@betterbasket/contracts";

/** Formats a Money value (integer minor units) as a locale-aware currency string. */
export function formatMoney(money: Money, locale = "en-US"): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency: money.currency }).format(
    money.amount / 100,
  );
}

export function addMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency) {
    throw new Error(`Cannot add different currencies: ${a.currency} vs ${b.currency}`);
  }
  return { amount: a.amount + b.amount, currency: a.currency };
}

export function multiplyMoney(money: Money, factor: number): Money {
  return { amount: Math.round(money.amount * factor), currency: money.currency };
}
