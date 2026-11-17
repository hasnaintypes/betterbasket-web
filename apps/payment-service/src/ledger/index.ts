/** Pure ledger row builders. Callers validate persisted balances and insert atomically. */
export type EntryType =
  | "charge"
  | "seller_allocation"
  | "commission"
  | "processing_fee"
  | "transfer"
  | "refund"
  | "transfer_reversal"
  | "refund_clearing"
  | "dispute_debit"
  | "dispute_fee"
  | "dispute_credit"
  | "adjustment"
  | "platform_receivable";

export interface LedgerRow {
  paymentId?: string;
  orderId?: string;
  subOrderId?: string;
  sellerId?: string;
  entryType: EntryType;
  debitAccount: string;
  creditAccount: string;
  amount: number;
  currency: string;
  providerObjectType: string;
  providerObjectId: string;
  idempotencyKey: string;
}

export interface PostingContext {
  paymentId: string;
  orderId: string;
  currency: string;
  stripeId: string;
  providerObjectType: string;
}

export interface SellerLine {
  subOrderId: string;
  sellerId: string;
  itemsSubtotal: number;
  shipping: number;
}

export interface PricedItem {
  unitPrice: number;
  quantity: number;
}

export interface Allocation extends SellerLine {
  gross: number;
  commission: number;
  sellerNet: number;
}

export const accounts = {
  stripeClearing: "stripe_clearing",
  unallocated: "unallocated_charge",
  commission: "platform_commission",
  processingFees: "processing_fee_expense",
  platformCash: "platform_cash",
  refundLiability: "refund_liability",
  refundPending: "refund_pending",
  disputeLiability: "dispute_liability",
  disputeFees: "dispute_fee_expense",
  adjustment: "platform_adjustment",
  sellerPayable: (sellerId: string) => `seller_payable:${sellerId}`,
  sellerReceivable: (sellerId: string) => `seller_receivable:${sellerId}`,
} as const;

function cents(value: number, label: string, allowZero = false): number {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1) || value > 2_147_483_647) {
    throw new RangeError(
      `${label} must be ${allowZero ? "nonnegative" : "positive"} integer cents`,
    );
  }
  return value;
}

function sum(values: number[], label: string): number {
  const total = values.reduce((acc, value) => acc + BigInt(value), 0n);
  if (total > 2_147_483_647n) throw new RangeError(`${label} exceeds ledger integer range`);
  return Number(total);
}

export function calculateItemsSubtotal(items: readonly PricedItem[]): number {
  if (!items.length) throw new Error("At least one item is required");
  const total = items.reduce((acc, item) => {
    cents(item.unitPrice, "Unit price");
    cents(item.quantity, "Quantity");
    return acc + BigInt(item.unitPrice) * BigInt(item.quantity);
  }, 0n);
  if (total > 2_147_483_647n) throw new RangeError("Items subtotal exceeds ledger integer range");
  return Number(total);
}

function context(ctx: PostingContext): void {
  for (const value of [ctx.paymentId, ctx.orderId, ctx.stripeId, ctx.providerObjectType]) {
    if (!value.trim()) throw new Error("Posting identifiers must be nonempty");
  }
  if (!/^[A-Z]{3}$/.test(ctx.currency)) throw new Error("Currency must be uppercase ISO code");
}

function row(
  ctx: PostingContext,
  entryType: EntryType,
  debitAccount: string,
  creditAccount: string,
  amount: number,
  index = 0,
  owner?: { sellerId: string; subOrderId: string },
): LedgerRow {
  context(ctx);
  cents(amount, "Ledger amount");
  if (!debitAccount.trim() || !creditAccount.trim() || debitAccount === creditAccount) {
    throw new Error("Ledger accounts must be nonempty and distinct");
  }
  if (owner && (!owner.sellerId.trim() || !owner.subOrderId.trim())) {
    throw new Error("Seller rows require seller and sub-order IDs");
  }
  return {
    paymentId: ctx.paymentId,
    orderId: ctx.orderId,
    ...(owner ? { subOrderId: owner.subOrderId, sellerId: owner.sellerId } : {}),
    entryType,
    debitAccount,
    creditAccount,
    amount,
    currency: ctx.currency,
    providerObjectType: ctx.providerObjectType,
    providerObjectId: ctx.stripeId,
    idempotencyKey: `${entryType}:${ctx.stripeId}:${index}`,
  };
}

/** Round a positive ratio half up without floating point arithmetic. */
export function roundHalfUp(amount: number, numerator: number, denominator: number): number {
  cents(amount, "Amount", true);
  cents(numerator, "Numerator", true);
  cents(denominator, "Denominator");
  return Number(
    (BigInt(amount) * BigInt(numerator) + BigInt(denominator) / 2n) / BigInt(denominator),
  );
}

export function calculateAllocations(
  lines: readonly SellerLine[],
  commissionBps: number,
): Allocation[] {
  if (!lines.length) throw new Error("At least one seller line is required");
  if (!Number.isInteger(commissionBps) || commissionBps < 0 || commissionBps > 10_000) {
    throw new RangeError("Commission must be 0..10000 basis points");
  }
  const seenSellers = new Set<string>();
  const seenSubOrders = new Set<string>();
  return [...lines]
    .sort((a, b) => a.subOrderId.localeCompare(b.subOrderId))
    .map((line) => {
      if (!line.sellerId.trim() || !line.subOrderId.trim())
        throw new Error("Seller IDs are required");
      if (seenSellers.has(line.sellerId) || seenSubOrders.has(line.subOrderId)) {
        throw new Error("Duplicate seller or sub-order");
      }
      seenSellers.add(line.sellerId);
      seenSubOrders.add(line.subOrderId);
      cents(line.itemsSubtotal, "Items subtotal", true);
      cents(line.shipping, "Shipping", true);
      const gross = sum([line.itemsSubtotal, line.shipping], "Seller gross");
      cents(gross, "Seller gross");
      const commission = roundHalfUp(line.itemsSubtotal, commissionBps, 10_000);
      return { ...line, gross, commission, sellerNet: gross - commission };
    });
}

export function postCharge(ctx: PostingContext, amount: number): LedgerRow[] {
  return [row(ctx, "charge", accounts.stripeClearing, accounts.unallocated, amount)];
}

export function postAllocation(
  ctx: PostingContext,
  allocations: readonly Allocation[],
  chargeAmount: number,
): LedgerRow[] {
  cents(chargeAmount, "Charge amount");
  if (!allocations.length) throw new Error("At least one allocation is required");
  const sellers = new Set<string>();
  const subOrders = new Set<string>();
  const sorted = [...allocations].sort((a, b) => a.subOrderId.localeCompare(b.subOrderId));
  for (const a of sorted) {
    if (
      !a.sellerId.trim() ||
      !a.subOrderId.trim() ||
      sellers.has(a.sellerId) ||
      subOrders.has(a.subOrderId)
    ) {
      throw new Error("Allocation requires one unique seller per sub-order");
    }
    sellers.add(a.sellerId);
    subOrders.add(a.subOrderId);
    cents(a.gross, "Gross");
    cents(a.commission, "Commission", true);
    cents(a.sellerNet, "Seller net", true);
    cents(a.itemsSubtotal, "Items subtotal", true);
    cents(a.shipping, "Shipping", true);
    if (sum([a.itemsSubtotal, a.shipping], "Seller gross") !== a.gross) {
      throw new Error("Items plus shipping must equal gross");
    }
    if (a.commission + a.sellerNet !== a.gross)
      throw new Error("Commission plus net must equal gross");
  }
  if (
    sum(
      sorted.map((a) => a.gross),
      "Allocations",
    ) !== chargeAmount
  ) {
    throw new Error("Allocations must equal charge");
  }
  const rows: LedgerRow[] = [];
  sorted.forEach((a, index) => {
    const owner = { sellerId: a.sellerId, subOrderId: a.subOrderId };
    if (a.sellerNet)
      rows.push(
        row(
          ctx,
          "seller_allocation",
          accounts.unallocated,
          accounts.sellerPayable(a.sellerId),
          a.sellerNet,
          index,
          owner,
        ),
      );
    if (a.commission)
      rows.push(
        row(
          ctx,
          "commission",
          accounts.unallocated,
          accounts.commission,
          a.commission,
          index,
          owner,
        ),
      );
  });
  return rows;
}

export function assertRefundCap(
  chargeAmount: number,
  alreadyRefunded: number,
  requested: number,
): void {
  cents(chargeAmount, "Charge amount");
  cents(alreadyRefunded, "Already refunded", true);
  cents(requested, "Refund amount");
  if (BigInt(alreadyRefunded) + BigInt(requested) > BigInt(chargeAmount)) {
    throw new RangeError("Cumulative refunds exceed charge");
  }
}

export function assertTransferCap(
  sellerPayable: number,
  alreadyTransferred: number,
  requested: number,
): void {
  cents(sellerPayable, "Seller payable", true);
  cents(alreadyTransferred, "Already transferred", true);
  cents(requested, "Transfer amount");
  if (BigInt(alreadyTransferred) + BigInt(requested) > BigInt(sellerPayable)) {
    throw new RangeError("Transfers exceed seller payable");
  }
}

export function postProcessingFee(ctx: PostingContext, amount: number): LedgerRow[] {
  return [row(ctx, "processing_fee", accounts.processingFees, accounts.stripeClearing, amount)];
}

export function postTransfer(
  ctx: PostingContext,
  owner: { sellerId: string; subOrderId: string },
  amount: number,
  sellerPayable: number,
  alreadyTransferred = 0,
): LedgerRow[] {
  assertTransferCap(sellerPayable, alreadyTransferred, amount);
  return [
    row(
      ctx,
      "transfer",
      accounts.sellerPayable(owner.sellerId),
      accounts.stripeClearing,
      amount,
      0,
      owner,
    ),
  ];
}

/** Refund policy supplies commission reversal; buyer-remorse refunds can keep it at zero. */
export function postRefund(
  ctx: PostingContext,
  owner: { sellerId: string; subOrderId: string },
  amount: number,
  commissionReversal: number,
  chargeAmount: number,
  alreadyRefunded: number,
): LedgerRow[] {
  assertRefundCap(chargeAmount, alreadyRefunded, amount);
  cents(commissionReversal, "Commission reversal", true);
  if (commissionReversal > amount) throw new RangeError("Commission reversal exceeds refund");
  const sellerShare = amount - commissionReversal;
  const rows = [
    row(ctx, "refund", accounts.refundLiability, accounts.refundPending, amount, 0, owner),
  ];
  if (sellerShare)
    rows.push(
      row(
        ctx,
        "seller_allocation",
        accounts.sellerPayable(owner.sellerId),
        accounts.refundLiability,
        sellerShare,
        0,
        owner,
      ),
    );
  if (commissionReversal)
    rows.push(
      row(
        ctx,
        "commission",
        accounts.commission,
        accounts.refundLiability,
        commissionReversal,
        0,
        owner,
      ),
    );
  return rows;
}

export function postTransferReversal(
  ctx: PostingContext,
  owner: { sellerId: string; subOrderId: string },
  amount: number,
): LedgerRow[] {
  return [
    row(
      ctx,
      "transfer_reversal",
      accounts.stripeClearing,
      accounts.sellerPayable(owner.sellerId),
      amount,
      0,
      owner,
    ),
  ];
}

export function postRefundClearing(ctx: PostingContext, amount: number): LedgerRow[] {
  return [row(ctx, "refund_clearing", accounts.refundPending, accounts.stripeClearing, amount)];
}

export function postPlatformReceivable(
  ctx: PostingContext,
  owner: { sellerId: string; subOrderId: string },
  amount: number,
): LedgerRow[] {
  return [
    row(
      ctx,
      "platform_receivable",
      accounts.sellerReceivable(owner.sellerId),
      accounts.sellerPayable(owner.sellerId),
      amount,
      0,
      owner,
    ),
  ];
}

export function postDisputeDebit(ctx: PostingContext, amount: number): LedgerRow[] {
  return [row(ctx, "dispute_debit", accounts.disputeLiability, accounts.stripeClearing, amount)];
}

export function postDisputeFee(ctx: PostingContext, amount: number): LedgerRow[] {
  return [row(ctx, "dispute_fee", accounts.disputeFees, accounts.stripeClearing, amount)];
}

export function postDisputeCredit(ctx: PostingContext, amount: number): LedgerRow[] {
  return [row(ctx, "dispute_credit", accounts.stripeClearing, accounts.disputeLiability, amount)];
}

export function postAdjustment(
  ctx: PostingContext,
  amount: number,
  debitAccount: string,
  creditAccount: string,
  owner?: { sellerId: string; subOrderId: string },
): LedgerRow[] {
  return [row(ctx, "adjustment", debitAccount, creditAccount, amount, 0, owner)];
}
