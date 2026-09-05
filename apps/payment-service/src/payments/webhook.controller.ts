import { BadRequestException, Controller, Headers, Post, Req } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import type { Request } from "express";
import { PaymentsService } from "./payments.service";

/**
 * Stripe calls this directly (not through the gateway's JWT-checking path).
 * Requires `rawBody: true` in main.ts's NestFactory.create() so `req.rawBody`
 * is the exact bytes Stripe signed — do not let any global body parser touch
 * this route first.
 */
@ApiExcludeController()
@Controller("payments/webhook")
export class WebhookController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post()
  async handle(@Req() req: Request & { rawBody?: Buffer }, @Headers("stripe-signature") signature: string) {
    if (!req.rawBody) throw new BadRequestException("Missing raw body");

    const event = this.paymentsService.verifyWebhookSignature(req.rawBody, signature);

    if (event.type === "payment_intent.succeeded" || event.type === "payment_intent.payment_failed") {
      await this.paymentsService.handlePaymentIntentEvent(event);
    }

    return { received: true };
  }
}
