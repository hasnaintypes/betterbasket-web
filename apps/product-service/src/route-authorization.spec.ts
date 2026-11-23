import { assertRoutesDeclared } from "@betterbasket/test-utils";
import { AppController } from "./app.controller";
import { ProductsController } from "./products/products.controller";

jest.mock("./products/products.service", () => ({ ProductsService: class ProductsService {} }));

describe("route authorization declarations", () => {
  it("declares every HTTP handler", () => {
    assertRoutesDeclared([AppController, ProductsController]);
  });
});
