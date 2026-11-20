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
  private readonly stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

  /**
   * Creates the commerce-side Seller row + a Stripe Connect Express account.
   * `organizationId` must already exist (created client-side via
   * `authClient.organization.create()` before calling this endpoint).
   */
  async onboard(organizationId: string, input: CreateSellerInput) {
    let slugBase: string;
    try {
      slugBase = sellerSlugBase(input.slug);
    } catch (error) {
      if (error instanceof InvalidSellerSlugError) throw new BadRequestException(error.message);
      throw error;
    }
    const existing = await db.query.sellers.findFirst({
      where: eq(sellers.organizationId, organizationId),
    });
    if (existing) throw new ConflictException("Seller already onboarded for this organization");

    const account = await this.stripe.accounts.create({
      type: "express",
      capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
    });

    let seller: typeof sellers.$inferSelect;
    try {
      seller = await insertWithSellerSlug(slugBase, async (slug) => {
        const [created] = await db
          .insert(sellers)
          .values({
            organizationId,
            storeName: input.storeName,
            slug,
            description: input.description,
            stripeAccountId: account.id,
            status: "stripe_pending",
          })
          .returning();
        if (!created) throw new Error("Seller insert returned no row");
        return created;
      });
    } catch (error) {
      if (error instanceof SellerSlugCollisionError) {
        throw new ConflictException("Could not allocate a unique seller slug");
      }
      throw error;
    }

    // TODO(Tier 3): publish Topics.SellerOnboarded once the Stripe account
    // finishes onboarding (via Stripe `account.updated` webhook), not here.
    return seller;
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
    const link = await this.stripe.accountLinks.create({
      account: seller.stripeAccountId!,
      type: "account_onboarding",
      return_url: returnUrl,
      refresh_url: refreshUrl,
    });
    return { url: link.url };
  }
}
