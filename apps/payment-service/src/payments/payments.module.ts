import { Module } from "@nestjs/common";
import { PaymentsService } from "./payments.service";
import { PaymentsController } from "./payments.controller";
import { WebhookController } from "./webhook.controller";
import { StripeProvider } from "./stripe.provider";
import { StripeWebhookInbox, StripeProcessorRegistry } from "./webhook.inbox";
import { pool } from "../db/pool";

@Module({
  controllers: [PaymentsController, WebhookController],
  providers: [
    StripeProvider,
    StripeProcessorRegistry,
    {
      provide: StripeWebhookInbox,
      useFactory: (provider: StripeProvider, registry: StripeProcessorRegistry) =>
        new StripeWebhookInbox(provider, registry, pool),
      inject: [StripeProvider, StripeProcessorRegistry],
    },
    PaymentsService,
  ],
})
export class PaymentsModule {}
