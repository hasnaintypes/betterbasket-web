import { NotImplementedException, ServiceUnavailableException } from "@nestjs/common";
import { db } from "../db/client";
import { OrdersService } from "./orders.service";

jest.mock("../db/client", () => ({ db: { query: { orders: { findMany: jest.fn() } } } }));

describe("order payment kill switch", () => {
  const original = process.env.PAYMENTS_ENABLED;
  const service = new OrdersService();
  afterEach(() => {
    if (original === undefined) delete process.env.PAYMENTS_ENABLED;
    else process.env.PAYMENTS_ENABLED = original;
    jest.clearAllMocks();
  });

  it("returns 503 PAYMENTS_DISABLED while leaving order reads available", async () => {
    process.env.PAYMENTS_ENABLED = "false";
    try {
      await service.create("buyer-1", {} as never);
      fail("Expected the payment kill switch to deny creation");
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect((error as ServiceUnavailableException).getStatus()).toBe(503);
      expect((error as ServiceUnavailableException).getResponse()).toMatchObject({
        code: "PAYMENTS_DISABLED",
      });
    }
    (db.query.orders.findMany as jest.Mock).mockResolvedValue([]);
    await expect(service.findMine("buyer-1")).resolves.toEqual([]);
  });

  it("preserves the current order stub when payments are enabled", async () => {
    process.env.PAYMENTS_ENABLED = "true";
    await expect(service.create("buyer-1", {} as never)).rejects.toBeInstanceOf(
      NotImplementedException,
    );
  });
});
