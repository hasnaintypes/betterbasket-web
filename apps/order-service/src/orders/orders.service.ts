import { Injectable, NotFoundException, NotImplementedException } from "@nestjs/common";
import { eq, and } from "drizzle-orm";
import type { CreateOrderInput } from "@betterbasket/contracts";
import { db } from "../db/client";
import { orders } from "../db/schema";
import { transitionSubOrder } from "./transition";
import type { SubOrderStatus, TransitionActor } from "./state-machine";

@Injectable()
export class OrdersService {
  /** Internal callers supply an authorized actor; no public transition route exists. */
  transition(subOrderId: string, to: SubOrderStatus, actor: TransitionActor, reason?: string) {
    return transitionSubOrder(db, subOrderId, to, actor, reason);
  }

  /**
   * TODO(Tier 2): resolve authoritative unit prices + sellerId per line item
   * by calling product-service (never trust client-supplied prices). Once
   * that's wired, this throws-away stub goes away and `create()` below does
   * the real insert + publishes Topics.OrderCreated via @betterbasket/kafka-client.
   */
  async create(_buyerId: string, _input: CreateOrderInput): Promise<never> {
    throw new NotImplementedException(
      "Order creation is not implemented yet: it needs product-service price resolution.",
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
}
