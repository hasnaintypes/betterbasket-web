import { Injectable, ConflictException, NotFoundException } from "@nestjs/common";
import { eq } from "drizzle-orm";
import Stripe from "stripe";
import { slugify } from "@betterbasket/utils";
import type { CreateSellerInput } from "@betterbasket/contracts";
import { db } from "../db/client";
import { sellers } from "../db/schema";

@Injectable()
export class SellersService {
  private readonly stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "sk_test_placeholder");

  /**
   * Creates the commerce-side Seller row + a Stripe Connect Express account.
   * `organizationId` must already exist (created client-side via
   * `authClient.organization.create()` before calling this endpoint).
   */
  async onboard(organizationId: string, input: CreateSellerInput) {
    const existing = await db.query.sellers.findFirst({
      where: eq(sellers.organizationId, organizationId),
    });
    if (existing) throw new ConflictException("Seller already onboarded for this organization");

    const account = await this.stripe.accounts.create({
      type: "express",
      capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
    });

    const [seller] = await db
      .insert(sellers)
      .values({
        organizationId,
        storeName: input.storeName,
        slug: `${slugify(input.slug)}-${Date.now().toString(36)}`,
        description: input.description,
        stripeAccountId: account.id,
        status: "stripe_pending",
      })
      .returning();

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
