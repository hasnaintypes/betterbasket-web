export const subOrderStatuses = [
  "awaiting_payment",
  "paid",
  "confirmed",
  "shipped",
  "delivered",
  "cancelled",
] as const;

export type SubOrderStatus = (typeof subOrderStatuses)[number];
export type OrderStatus = "awaiting_payment" | "paid" | "in_fulfilment" | "fulfilled" | "cancelled";
export type TransitionActor = {
  id: string;
  kind: "buyer" | "seller" | "admin" | "system" | "payment";
};

const transitions: Record<SubOrderStatus, readonly SubOrderStatus[]> = {
  awaiting_payment: ["paid", "cancelled"],
  paid: ["confirmed", "cancelled"],
  confirmed: ["shipped", "cancelled"],
  shipped: ["delivered", "cancelled"],
  delivered: [],
  cancelled: [],
};

export function canTransition(
  from: SubOrderStatus,
  to: SubOrderStatus,
  actor: TransitionActor,
): boolean {
  return (
    transitions[from].includes(to) &&
    !(from === "shipped" && to === "cancelled" && actor.kind !== "admin")
  );
}

/** Order status follows its active seller branches; payment remains pending until all are paid. */
export function deriveOrderStatus(statuses: readonly SubOrderStatus[]): OrderStatus {
  if (statuses.length === 0) throw new Error("An order must have a sub-order");
  const active = statuses.filter((status) => status !== "cancelled");
  if (active.length === 0) return "cancelled";
  if (active.some((status) => status === "awaiting_payment")) return "awaiting_payment";
  if (active.every((status) => status === "delivered")) return "fulfilled";
  if (active.some((status) => status === "shipped" || status === "delivered"))
    return "in_fulfilment";
  return "paid";
}
