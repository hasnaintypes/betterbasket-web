import { ConflictException } from "@nestjs/common";
import { OutboxWriter } from "@betterbasket/outbox";
import { db } from "../db/client";
import { SellersService } from "./sellers.service";
import type { SellerStripeProvider } from "./stripe.provider";

jest.mock("../db/client", () => ({
  db: { query: { sellers: { findFirst: jest.fn() } }, transaction: jest.fn() },
}));

const seller = {
  id: "e2568c43-447b-4a16-8f6c-ae4ea9378a13",
  organizationId: "org-1",
  country: "US",
  status: "pending",
  stripeAccountId: null,
  version: 0,
};

describe("SellersService Stripe account transition", () => {
  const originalEnv = { ...process.env };
  const find = db.query.sellers.findFirst as jest.Mock;
  const transaction = db.transaction as jest.Mock;
  const createAccount = jest.fn().mockResolvedValue({ id: "acct_test" });
  const service = new SellersService({ createAccount } as unknown as SellerStripeProvider);

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NODE_ENV = "test";
    find.mockResolvedValue(seller);
    jest.spyOn(OutboxWriter, "add");
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
  });

  it("reuses the Stripe account after a database failure and writes history and outbox atomically", async () => {
    const updated = {
      ...seller,
      status: "stripe_pending",
      stripeAccountId: "acct_test",
      version: 1,
    };
    const returning = jest.fn().mockResolvedValue([updated]);
    const insertValues = jest.fn().mockResolvedValue(undefined);
    const tx = {
      update: () => ({ set: () => ({ where: () => ({ returning }) }) }),
      insert: () => ({ values: insertValues }),
      execute: jest.fn().mockResolvedValue(undefined),
    };
    transaction.mockRejectedValueOnce(new Error("database update failed"));
    transaction.mockImplementationOnce((callback) => callback(tx));
    await expect(service.createStripeAccount("org-1", "owner-1")).rejects.toThrow(
      "database update failed",
    );
    await expect(service.createStripeAccount("org-1", "owner-1")).resolves.toEqual({
      id: seller.id,
      status: "stripe_pending",
      stripeAccountId: "acct_test",
    });
    expect(createAccount).toHaveBeenCalledTimes(2);
    expect(createAccount).toHaveBeenNthCalledWith(1, seller.id, "US");
    expect(createAccount).toHaveBeenNthCalledWith(2, seller.id, "US");
    expect(insertValues).toHaveBeenCalledWith({
      sellerId: seller.id,
      fromStatus: "pending",
      toStatus: "stripe_pending",
      actorId: "owner-1",
    });
    expect(OutboxWriter.add).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        type: "seller.onboarded",
        payload: { sellerId: seller.id, organizationId: "org-1", stripeAccountId: "acct_test" },
      }),
    );
    expect(tx.execute).toHaveBeenCalledTimes(1);
  });

  it("rejects account creation from a non-pending seller without calling Stripe", async () => {
    find.mockResolvedValue({ ...seller, status: "active" });
    await expect(service.createStripeAccount("org-1", "owner-1")).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(createAccount).not.toHaveBeenCalled();
  });
});
