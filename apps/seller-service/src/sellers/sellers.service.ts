import {
  BadRequestException,
  Injectable,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { CreateSellerInput } from "@betterbasket/contracts";
import { OutboxWriter } from "@betterbasket/outbox";
import { db } from "../db/client";
import { sellers, sellerStatusHistory } from "../db/schema";
import {
  InvalidSellerSlugError,
  SellerSlugCollisionError,
  insertWithSellerSlug,
  sellerSlugBase,
} from "./slug";
import { SellerStripeProvider } from "./stripe.provider";

@Injectable()
export class SellersService {
  constructor(private readonly stripe: SellerStripeProvider) {}

  /** Creates the pending commerce record before any provider side effect. */
  async onboard(organizationId: string, input: CreateSellerInput) {
    const existing = await db.query.sellers.findFirst({
      where: eq(sellers.organizationId, organizationId),
    });
    if (existing) return { id: existing.id, status: existing.status, slug: existing.slug };
    const allowed = (process.env.SUPPORTED_SELLER_COUNTRIES ?? "")
      .split(",")
      .map((country) => country.trim().toUpperCase())
      .filter(Boolean);
    if (process.env.NODE_ENV !== "test" && !allowed.includes(input.country)) {
      throw new BadRequestException({
        code: "VALIDATION_FAILED",
        message: "Seller registration is unavailable for this country",
      });
    }
    let slugBase: string;
    try {
      slugBase = sellerSlugBase(input.slug);
    } catch (error) {
      if (error instanceof InvalidSellerSlugError) throw new BadRequestException(error.message);
      throw error;
    }
    let seller: typeof sellers.$inferSelect | undefined;
    try {
      seller = await insertWithSellerSlug(slugBase, async (slug) => {
        const [created] = await db
          .insert(sellers)
          .values({
            organizationId,
            storeName: input.storeName,
            slug,
            description: input.description,
            country: input.country,
            supportEmail: input.supportEmail,
            status: "pending",
          })
          .onConflictDoNothing({ target: sellers.organizationId })
          .returning();
        return created;
      });
    } catch (error) {
      if (error instanceof SellerSlugCollisionError) {
        throw new ConflictException("Could not allocate a unique seller slug");
      }
      throw error;
    }

    const row =
      seller ??
      (await db.query.sellers.findFirst({ where: eq(sellers.organizationId, organizationId) }));
    if (!row) throw new Error("Seller insert returned no row");
    return { id: row.id, status: row.status, slug: row.slug };
  }

  async findByOrganization(organizationId: string) {
    const seller = await db.query.sellers.findFirst({
      where: eq(sellers.organizationId, organizationId),
    });
    if (!seller) throw new NotFoundException("Seller not found for this organization");
    return seller;
  }

  async createStripeAccount(organizationId: string, actorId: string) {
    const seller = await this.findByOrganization(organizationId);
    if (seller.status === "stripe_pending" && seller.stripeAccountId) {
      return { id: seller.id, status: seller.status, stripeAccountId: seller.stripeAccountId };
    }
    if (seller.status !== "pending" || seller.stripeAccountId) {
      throw new ConflictException({ code: "INVALID_TRANSITION" });
    }
    const allowed = (process.env.SUPPORTED_SELLER_COUNTRIES ?? "")
      .split(",")
      .map((country) => country.trim().toUpperCase())
      .filter(Boolean);
    if (!seller.country || (process.env.NODE_ENV !== "test" && !allowed.includes(seller.country))) {
      throw new BadRequestException({
        code: "VALIDATION_FAILED",
        message: "Seller country is unavailable",
      });
    }
    const account = await this.stripe.createAccount(seller.id, seller.country);
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(sellers)
        .set({ stripeAccountId: account.id, status: "stripe_pending", version: seller.version + 1 })
        .where(
          and(
            eq(sellers.id, seller.id),
            eq(sellers.status, "pending"),
            eq(sellers.version, seller.version),
          ),
        )
        .returning();
      if (!row) return null;
      await tx.insert(sellerStatusHistory).values({
        sellerId: seller.id,
        fromStatus: "pending",
        toStatus: "stripe_pending",
        actorId,
      });
      const eventId = randomUUID();
      await OutboxWriter.add(tx, {
        id: eventId,
        type: "seller.onboarded",
        version: 1,
        occurredAt: new Date(),
        producer: "seller-service",
        aggregateType: "seller",
        aggregateId: seller.id,
        aggregateVersion: row.version,
        correlationId: eventId,
        causationId: eventId,
        payload: {
          sellerId: seller.id,
          organizationId,
          stripeAccountId: account.id,
        },
      });
      return row;
    });
    if (!updated) {
      const latest = await this.findByOrganization(organizationId);
      if (latest.status !== "stripe_pending" || latest.stripeAccountId !== account.id) {
        throw new ConflictException({ code: "INVALID_TRANSITION" });
      }
      return { id: latest.id, status: latest.status, stripeAccountId: latest.stripeAccountId };
    }
    return { id: updated.id, status: updated.status, stripeAccountId: updated.stripeAccountId };
  }

  /** Generates a Stripe-hosted link using only configured frontend origins. */
  async createOnboardingLink(organizationId: string) {
    const seller = await this.findByOrganization(organizationId);
    if (seller.status !== "stripe_pending" || !seller.stripeAccountId) {
      throw new ConflictException({ code: "INVALID_TRANSITION" });
    }
    const link = await this.stripe.createOnboardingLink(seller.stripeAccountId);
    return { url: link.url };
  }
}
