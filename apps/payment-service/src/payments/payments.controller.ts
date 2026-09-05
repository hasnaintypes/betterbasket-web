import { Body, Controller, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Auth } from "@betterbasket/auth-shared";
import { PaymentsService } from "./payments.service";

interface CreateIntentBody {
  orderId: string;
  amount: number;
  currency: string;
  connectedAccountId: string;
}

@ApiTags("payments")
@Controller("payments")
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post("intents")
  @Auth("customer")
  @ApiBearerAuth()
  createIntent(@Body() body: CreateIntentBody) {
    return this.paymentsService.createPaymentIntent(
      body.orderId,
      body.amount,
      body.currency,
      body.connectedAccountId,
    );
  }
}
