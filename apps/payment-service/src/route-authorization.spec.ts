import { assertRoutesDeclared } from "@betterbasket/test-utils";
import { AppController } from "./app.controller";
import { PaymentsController } from "./payments/payments.controller";
import { WebhookController } from "./payments/webhook.controller";

describe("route authorization declarations", () => {
  it("declares every HTTP handler", () => {
    assertRoutesDeclared([AppController, PaymentsController, WebhookController]);
  });
});
