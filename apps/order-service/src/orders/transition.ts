import { randomUUID } from "node:crypto";
import { ConflictException, NotFoundException } from "@nestjs/common";
import { OutboxWriter } from "@betterbasket/outbox";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import { orders, orderStatusHistory, subOrders, subOrderStatusHistory } from "../db/schema";
import {
  canTransition,
  deriveOrderStatus,
  type SubOrderStatus,
  type TransitionActor,
} from "./state-machine";

function invalidTransition(): never {
  throw new ConflictException({
    code: "INVALID_TRANSITION",
    message: "Invalid order status transition",
  });
}

export async function transitionSubOrder(
  database: typeof db,
  subOrderId: string,
  to: SubOrderStatus,
  actor: TransitionActor,
  reason?: string,
  correlationId = randomUUID(),
) {
  if (!actor.id.trim()) invalidTransition();
  return database.transaction(async (tx) => {
    const [initial] = await tx
      .select({ orderId: subOrders.orderId })
      .from(subOrders)
      .where(eq(subOrders.id, subOrderId));
    if (!initial) throw new NotFoundException("Sub-order not found");

    // Serialize all seller branches of an order before deriving the parent status.
    await tx.execute(sql`SELECT id FROM orders WHERE id = ${initial.orderId} FOR UPDATE`);
    const [current] = await tx.select().from(subOrders).where(eq(subOrders.id, subOrderId));
    if (!current) throw new NotFoundException("Sub-order not found");
    if (current.status === to) return { changed: false, status: to };
    if (!canTransition(current.status, to, actor)) invalidTransition();

    const [updated] = await tx
      .update(subOrders)
      .set({ status: to, version: current.version + 1, updatedAt: new Date() })
      .where(
        and(
          eq(subOrders.id, subOrderId),
          eq(subOrders.status, current.status),
          eq(subOrders.version, current.version),
        ),
      )
      .returning({ id: subOrders.id });
    if (!updated) invalidTransition();

    await tx.insert(subOrderStatusHistory).values({
      subOrderId,
      fromStatus: current.status,
      toStatus: to,
      actorId: actor.id,
      reason,
    });
    const occurredAt = new Date();
    const eventBase = {
      id: randomUUID(),
      type: "order.status-changed",
      version: 2,
      occurredAt,
      producer: "order-service",
      aggregateType: "order",
      aggregateId: current.orderId,
      correlationId,
      causationId: correlationId,
    };
    await OutboxWriter.add(tx, {
      ...eventBase,
      payload: {
        orderId: current.orderId,
        subOrderId,
        sellerId: current.sellerId,
        previousStatus: current.status,
        newStatus: to,
      },
    });

    const [order] = await tx.select().from(orders).where(eq(orders.id, current.orderId));
    if (!order) throw new NotFoundException("Order not found");
    const branches = await tx
      .select({ status: subOrders.status })
      .from(subOrders)
      .where(eq(subOrders.orderId, current.orderId));
    const derived = deriveOrderStatus(branches.map((branch) => branch.status));
    if (derived !== order.status) {
      const [parent] = await tx
        .update(orders)
        .set({ status: derived, version: order.version + 1, updatedAt: new Date() })
        .where(
          and(
            eq(orders.id, order.id),
            eq(orders.status, order.status),
            eq(orders.version, order.version),
          ),
        )
        .returning({ id: orders.id });
      if (!parent) invalidTransition();
      await tx.insert(orderStatusHistory).values({
        orderId: order.id,
        fromStatus: order.status,
        toStatus: derived,
        actorId: actor.id,
        reason,
      });
      await OutboxWriter.add(tx, {
        ...eventBase,
        id: randomUUID(),
        aggregateVersion: order.version + 1,
        payload: { orderId: order.id, previousStatus: order.status, newStatus: derived },
      });
    }
    return { changed: true, status: to, orderStatus: derived };
  });
}
