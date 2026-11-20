import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  PayloadTooLargeException,
  Post,
  Req,
} from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import type { Request } from "express";
import { StripeWebhookInbox } from "./webhook.inbox";
import type { StripeWebhookScope } from "./stripe.provider";

/**
 * Stripe calls this directly (not through the gateway's JWT-checking path).
 * Requires `rawBody: true` in main.ts's NestFactory.create() so `req.rawBody`
 * is the exact bytes Stripe signed — do not let any global body parser touch
 * this route first.
 */
@ApiExcludeController()
@Controller("payments/webhook")
export class WebhookController {
  constructor(private readonly inbox: StripeWebhookInbox) {}

  @Post("account")
  @HttpCode(200)
  handleAccount(
    @Req() req: Request & { rawBody?: Buffer },
    @Headers("stripe-signature") signature: string | undefined,
  ) {
    return this.handle(req, signature, "account");
  }

  @Post("connect")
  @HttpCode(200)
  handleConnect(
    @Req() req: Request & { rawBody?: Buffer },
    @Headers("stripe-signature") signature: string | undefined,
  ) {
    return this.handle(req, signature, "connect");
  }

  private handle(
    req: Request & { rawBody?: Buffer },
    signature: string | undefined,
    scope: StripeWebhookScope,
  ) {
    if (!req.rawBody) throw new BadRequestException("Missing raw body");
    if (req.rawBody.length > 1024 * 1024)
      throw new PayloadTooLargeException("Webhook body too large");
    if (!signature) throw new BadRequestException("Missing Stripe signature");
    return this.inbox.receive(req.rawBody, signature, scope);
  }
}
