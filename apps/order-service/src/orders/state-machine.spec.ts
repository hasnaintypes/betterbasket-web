import {
  canTransition,
  deriveOrderStatus,
  subOrderStatuses,
  type TransitionActor,
} from "./state-machine";

const seller: TransitionActor = { id: "seller-1", kind: "seller" };
const admin: TransitionActor = { id: "admin-1", kind: "admin" };
const allowed = new Set([
  "awaiting_payment:paid",
  "awaiting_payment:cancelled",
  "paid:confirmed",
  "paid:cancelled",
  "confirmed:shipped",
  "confirmed:cancelled",
  "shipped:delivered",
]);

describe("sub-order transitions", () => {
  it.each(subOrderStatuses.flatMap((from) => subOrderStatuses.map((to) => [from, to] as const)))(
    "%s → %s matches the transition table",
    (from, to) => {
      expect(canTransition(from, to, seller)).toBe(allowed.has(`${from}:${to}`));
    },
  );

  it("permits shipped cancellation only for an admin", () => {
    expect(canTransition("shipped", "cancelled", seller)).toBe(false);
    expect(canTransition("shipped", "cancelled", admin)).toBe(true);
  });
});

describe("derived order status", () => {
  it.each([
    [["awaiting_payment", "paid"], "awaiting_payment"],
    [["paid", "confirmed"], "paid"],
    [["confirmed", "shipped"], "in_fulfilment"],
    [["delivered", "cancelled"], "fulfilled"],
    [["cancelled", "cancelled"], "cancelled"],
  ] as const)("derives %j as %s", (statuses, expected) => {
    expect(deriveOrderStatus(statuses)).toBe(expected);
  });

  it("is independent of branch order for every three-branch combination", () => {
    for (const a of subOrderStatuses)
      for (const b of subOrderStatuses)
        for (const c of subOrderStatuses) {
          const states = [a, b, c];
          expect(deriveOrderStatus(states)).toBe(deriveOrderStatus([c, a, b]));
          expect(deriveOrderStatus(states)).toBe(deriveOrderStatus([b, c, a]));
        }
  });
});
