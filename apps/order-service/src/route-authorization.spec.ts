import { assertRoutesDeclared } from "@betterbasket/test-utils";
import { AppController } from "./app.controller";
import { OrdersController } from "./orders/orders.controller";

describe("route authorization declarations", () => {
  it("declares every HTTP handler", () => {
    assertRoutesDeclared([AppController, OrdersController]);
  });
});
