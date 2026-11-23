import { assertRoutesDeclared } from "@betterbasket/test-utils";
import { AppController } from "./app.controller";

describe("route authorization declarations", () => {
  it("declares every HTTP handler", () => {
    assertRoutesDeclared([AppController]);
  });
});
