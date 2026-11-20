import fc from "fast-check";
import {
  accounts,
  assertRefundCap,
  assertTransferCap,
  calculateAllocations,
  calculateItemsSubtotal,
  postAdjustment,
  postAllocation,
  postCharge,
  postDisputeCredit,
  postDisputeDebit,
  postDisputeFee,
  postPlatformReceivable,
  postProcessingFee,
  postRefund,
  postRefundClearing,
  postTransfer,
  postTransferReversal,
  roundHalfUp,
  type LedgerRow,
  type PostingContext,
} from "./index";

const ctx = (stripeId: string): PostingContext => ({
  paymentId: "00000000-0000-4000-8000-000000000001",
  orderId: "00000000-0000-4000-8000-000000000002",
  currency: "USD",
  stripeId,
  providerObjectType: "charge",
});
const ownerA = {
  sellerId: "00000000-0000-4000-8000-000000000003",
  subOrderId: "00000000-0000-4000-8000-000000000004",
};
const ownerB = {
  sellerId: "00000000-0000-4000-8000-000000000005",
  subOrderId: "00000000-0000-4000-8000-000000000006",
};

function balance(rows: LedgerRow[], account: string): number {
  return rows.reduce(
    (value, entry) =>
      value +
      (entry.debitAccount === account ? entry.amount : 0) -
      (entry.creditAccount === account ? entry.amount : 0),
    0,
  );
}

describe("ledger golden example", () => {
  it("posts the $100 two-seller order, fee, transfer, and seller-caused refund", () => {
    const allocations = calculateAllocations(
      [
        { ...ownerB, itemsSubtotal: 4000, shipping: 0 },
        { ...ownerA, itemsSubtotal: 6000, shipping: 0 },
      ],
      1000,
    );
    expect(
      allocations.map(({ gross, commission, sellerNet }) => ({ gross, commission, sellerNet })),
    ).toEqual([
      { gross: 6000, commission: 600, sellerNet: 5400 },
      { gross: 4000, commission: 400, sellerNet: 3600 },
    ]);
    const charged = [
      ...postCharge(ctx("ch_100"), 10000),
      ...postAllocation(ctx("ch_100"), allocations, 10000),
    ];
    expect(charged.map(({ entryType, amount }) => ({ entryType, amount }))).toEqual([
      { entryType: "charge", amount: 10000 },
      { entryType: "seller_allocation", amount: 5400 },
      { entryType: "commission", amount: 600 },
      { entryType: "seller_allocation", amount: 3600 },
      { entryType: "commission", amount: 400 },
    ]);
    expect(balance(charged, accounts.unallocated)).toBe(0);
    expect(balance(charged, accounts.sellerPayable(ownerA.sellerId))).toBe(-5400);
    expect(balance(charged, accounts.sellerPayable(ownerB.sellerId))).toBe(-3600);
    expect(balance(charged, accounts.commission)).toBe(-1000);

    const rows = [
      ...charged,
      ...postProcessingFee(ctx("fee_320"), 320),
      ...postTransfer(ctx("tr_A"), ownerA, 5400, 5400),
      ...postTransferReversal(ctx("trr_A"), ownerA, 5400),
      ...postRefund(ctx("re_A"), ownerA, 6000, 600, 10000, 0),
      ...postRefundClearing(ctx("re_A"), 6000),
    ];
    expect(rows.find((r) => r.entryType === "processing_fee")?.amount).toBe(320);
    expect(rows.find((r) => r.entryType === "transfer_reversal")?.amount).toBe(5400);
    expect(rows.find((r) => r.entryType === "refund")?.amount).toBe(6000);
    expect(
      rows.find((r) => r.entryType === "commission" && r.providerObjectId === "re_A")?.amount,
    ).toBe(600);
    expect(balance(rows, accounts.sellerPayable(ownerA.sellerId))).toBe(0);
    expect(balance(rows, accounts.commission)).toBe(-400);
    expect(balance(rows, accounts.refundLiability)).toBe(0);
    expect(balance(rows, accounts.refundPending)).toBe(0);
    expect(new Set(rows.map((r) => r.idempotencyKey)).size).toBe(rows.length);
    expect(rows.every((r) => r.amount > 0 && r.debitAccount !== r.creditAccount)).toBe(true);
    expect(rows.filter((r) => r.subOrderId).every((r) => r.sellerId)).toBe(true);
  });
});

describe("allocation properties", () => {
  it("conserves all 10,000 generated orders", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc
            .record({
              itemsSubtotal: fc.integer({ min: 0, max: 100_000 }),
              shipping: fc.integer({ min: 0, max: 10_000 }),
            })
            .filter((line) => line.itemsSubtotal + line.shipping > 0),
          { minLength: 1, maxLength: 30 },
        ),
        fc.integer({ min: 0, max: 10_000 }),
        (amounts, bps) => {
          const lines = amounts.map((a, i) => ({
            ...a,
            sellerId: `seller-${i}`,
            subOrderId: `sub-${i}`,
          }));
          const allocations = calculateAllocations(lines, bps);
          const charge = amounts.reduce((total, a) => total + a.itemsSubtotal + a.shipping, 0);
          const rows = postAllocation(ctx("ch_property"), allocations, charge);
          expect(allocations.reduce((total, a) => total + a.gross, 0)).toBe(charge);
          expect(allocations.every((a) => a.commission + a.sellerNet === a.gross)).toBe(true);
          expect(rows.reduce((total, r) => total + r.amount, 0)).toBe(charge);
          expect(rows.every((r) => r.sellerId && r.subOrderId)).toBe(true);
          const refunded = charge === 1 ? 0 : Math.floor(charge / 2);
          expect(() => assertRefundCap(charge, refunded, charge - refunded)).not.toThrow();
          expect(() => assertRefundCap(charge, refunded, charge - refunded + 1)).toThrow();
        },
      ),
      { numRuns: 10_000 },
    );
  }, 120_000);

  it("handles one-cent orders, shipping, zero and full commission, and rejects malformed lines", () => {
    const line = { ...ownerA, itemsSubtotal: 1, shipping: 0 };
    expect(calculateAllocations([line], 0)[0]).toMatchObject({
      gross: 1,
      commission: 0,
      sellerNet: 1,
    });
    expect(calculateAllocations([line], 10_000)[0]).toMatchObject({
      gross: 1,
      commission: 1,
      sellerNet: 0,
    });
    expect(calculateAllocations([{ ...line, shipping: 1 }], 10_000)[0]).toMatchObject({
      gross: 2,
      commission: 1,
      sellerNet: 1,
    });
    expect(roundHalfUp(5, 1000, 10_000)).toBe(1);
    expect(
      calculateItemsSubtotal([
        { unitPrice: 7, quantity: 3 },
        { unitPrice: 1, quantity: 1 },
      ]),
    ).toBe(22);
    expect(() => calculateItemsSubtotal([{ unitPrice: 0, quantity: 1 }])).toThrow();
    expect(() => calculateAllocations([{ ...line, itemsSubtotal: 0 }], 0)).toThrow();
    expect(() =>
      calculateAllocations([line, { ...line, subOrderId: ownerB.subOrderId }], 0),
    ).toThrow();
    expect(() => postAllocation(ctx("ch_bad"), calculateAllocations([line], 0), 2)).toThrow();
    expect(() => assertRefundCap(100, 80, 21)).toThrow();
    expect(() => assertTransferCap(5400, 5400, 1)).toThrow();
    expect(() => postCharge(ctx("ch_zero"), 0)).toThrow();
  });

  it("builds all compensating and dispute rows without I/O", () => {
    const rows = [
      ...postPlatformReceivable(ctx("re_gap"), ownerA, 10),
      ...postDisputeDebit(ctx("dp_1"), 10),
      ...postDisputeFee(ctx("dp_fee"), 15),
      ...postDisputeCredit(ctx("dp_win"), 10),
      ...postAdjustment(ctx("adj_1"), 3, accounts.adjustment, accounts.platformCash),
    ];
    expect(rows.map((r) => r.entryType)).toEqual([
      "platform_receivable",
      "dispute_debit",
      "dispute_fee",
      "dispute_credit",
      "adjustment",
    ]);
    expect(rows[0]).toMatchObject(ownerA);
    expect(rows.every((r) => r.idempotencyKey === `${r.entryType}:${r.providerObjectId}:0`)).toBe(
      true,
    );
    expect(() => postRefund(ctx("re_bad"), ownerA, 50, 51, 100, 0)).toThrow();
  });
});
