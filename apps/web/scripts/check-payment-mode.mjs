const flag = process.env.PAYMENTS_LIVE_MODE_ENABLED ?? "false";
if (flag !== "true" && flag !== "false") {
  throw new Error("PAYMENTS_LIVE_MODE_ENABLED must be true or false");
}
if (flag === "false" && process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.startsWith("pk_live_")) {
  throw new Error("Live Stripe publishable key requires PAYMENTS_LIVE_MODE_ENABLED=true");
}
