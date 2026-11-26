import { Injectable, NotImplementedException, ServiceUnavailableException } from "@nestjs/common";
import { paymentsEnabled } from "../config";

@Injectable()
export class PaymentsService {
  /** Issue #98 will derive amount and seller payouts from the persisted order. */
  createPaymentIntent(): never {
    if (!paymentsEnabled()) {
      throw new ServiceUnavailableException({
        code: "PAYMENTS_DISABLED",
        message: "Payments are currently unavailable",
      });
    }
    throw new NotImplementedException("Payment intent creation is not implemented yet");
  }
}
