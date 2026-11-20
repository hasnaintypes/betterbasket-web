import { Controller, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Auth } from "@betterbasket/auth-shared";
import { PaymentsService } from "./payments.service";

@ApiTags("payments")
@Controller("payments")
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post("intents")
  @Auth("customer")
  @ApiBearerAuth()
  createIntent() {
    return this.paymentsService.createPaymentIntent();
  }
}
