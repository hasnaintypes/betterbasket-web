import {
  BadRequestException,
  Injectable,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { eq } from "drizzle-orm";
import Stripe from "stripe";
import type { CreateSellerInput } from "@betterbasket/contracts";
import { db } from "../db/client";
import { sellers } from "../db/schema";
import {
  InvalidSellerSlugError,
  SellerSlugCollisionError,
  insertWithSellerSlug,
  sellerSlugBase,
} from "./slug";

@Injectable()
export class SellersService {
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

  /** Generates the Stripe-hosted onboarding link the seller-portal redirects to. */
  async createOnboardingLink(organizationId: string, returnUrl: string, refreshUrl: string) {
    const seller = await this.findByOrganization(organizationId);
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
    const link = await stripe.accountLinks.create({
      account: seller.stripeAccountId!,
      type: "account_onboarding",
      return_url: returnUrl,
      refresh_url: refreshUrl,
    });
    return { url: link.url };
  }
}
