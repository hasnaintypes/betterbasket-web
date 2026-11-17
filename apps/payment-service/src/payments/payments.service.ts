import { Injectable, NotImplementedException } from "@nestjs/common";

@Injectable()
export class PaymentsService {
  /** Issue #98 will derive amount and seller payouts from the persisted order. */
  createPaymentIntent(): never {
    throw new NotImplementedException("Payment intent creation is not implemented yet");
  }
}
