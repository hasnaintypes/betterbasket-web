import { Controller, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Capability } from "@betterbasket/auth-shared";
import { PaymentsService } from "./payments.service";

@ApiTags("payments")
@Controller("payments")
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post("intents")
  @Capability("payment:create")
  @ApiBearerAuth()
  createIntent() {
    return this.paymentsService.createPaymentIntent();
  }
}
