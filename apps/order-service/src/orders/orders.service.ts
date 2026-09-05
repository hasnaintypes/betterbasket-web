import { Injectable, NotFoundException, NotImplementedException } from "@nestjs/common";
import { eq, and } from "drizzle-orm";
import type { CreateOrderInput } from "@betterbasket/contracts";
import { db } from "../db/client";
import { orders, orderStatusEnum } from "../db/schema";

@Injectable()
export class OrdersService {
  /**
   * TODO(Tier 2): resolve authoritative unit prices + sellerId per line item
   * by calling product-service (never trust client-supplied prices). Once
   * that's wired, this throws-away stub goes away and `create()` below does
   * the real insert + publishes Topics.OrderCreated via @betterbasket/kafka-client.
   */
  async create(_buyerId: string, _input: CreateOrderInput): Promise<never> {
    throw new NotImplementedException(
      "Order creation needs product-service price resolution — tracked in docs/PRD.md Tier 2.",
    );
  }

  async findById(id: string, buyerId: string) {
    const order = await db.query.orders.findFirst({
      where: and(eq(orders.id, id), eq(orders.buyerId, buyerId)),
    });
    if (!order) throw new NotFoundException(`Order ${id} not found`);
    return order;
  }

  async findMine(buyerId: string) {
    return db.query.orders.findMany({ where: eq(orders.buyerId, buyerId) });
  }

  async updateStatus(id: string, status: (typeof orderStatusEnum.enumValues)[number]) {
    const [updated] = await db
      .update(orders)
      .set({ status, updatedAt: new Date() })
      .where(eq(orders.id, id))
      .returning();
    if (!updated) throw new NotFoundException(`Order ${id} not found`);
    // TODO(Tier 3): publish Topics.OrderStatusChanged.
    return updated;
  }
}
