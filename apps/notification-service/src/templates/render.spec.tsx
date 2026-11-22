import { renderTemplate, type TemplateData, type TemplateOrigins } from "./index";

const origins: TemplateOrigins = {
  storefrontOrigin: "https://shop.example.test",
  sellerPortalOrigin: "https://seller.example.test",
  allowedOrigins: ["https://shop.example.test", "https://seller.example.test"],
};

const order = { orderId: "order_123", customerName: "Ada" };
const fixtures: TemplateData[] = [
  {
    kind: "order-confirmation",
    ...order,
    currency: "USD",
    totalMinor: 2199,
    items: [{ name: "Market basket", quantity: 1, unitPriceMinor: 2199 }],
  },
  { kind: "payment-failed", ...order },
  { kind: "order-shipped", ...order, carrier: "Parcel Post", trackingNumber: "TRACK-1" },
  { kind: "order-delivered", ...order },
  { kind: "order-cancelled", ...order },
  { kind: "refund-issued", ...order, currency: "USD", amountMinor: 2199 },
  { kind: "seller-new-order", orderId: "order_123", storeName: "Ada's Store" },
  { kind: "seller-approved", storeName: "Ada's Store" },
  { kind: "seller-suspended", storeName: "Ada's Store" },
];

describe("transactional email templates", () => {
  test.each(fixtures)("$kind snapshot", (fixture) => {
    expect(renderTemplate(fixture, origins)).toMatchSnapshot();
  });

  test("escapes payload text in HTML and controls plain-text line breaks", () => {
    const result = renderTemplate(
      {
        kind: "order-confirmation",
        orderId: "order_123",
        customerName: "<img src=x onerror=alert(1)>\nA",
        currency: "USD",
        totalMinor: 100,
        items: [{ name: "<script>alert(1)</script>", quantity: 1, unitPriceMinor: 100 }],
      },
      origins,
    );
    expect(result.html).not.toContain("<script>");
    expect(result.html).not.toContain("<img src=x");
    expect(result.html).toContain("&lt;script&gt;");
    expect(result.text).toContain("Hi <img src=x onerror=alert(1)> A,");
    expect(result.text).not.toContain("<img src=x onerror=alert(1)>\nA");
  });

  test("builds only allow-listed links and rejects payload URLs", () => {
    expect(renderTemplate({ kind: "payment-failed", ...order }, origins).html).toContain(
      "https://shop.example.test/account/orders/order_123",
    );
    expect(() =>
      renderTemplate(
        { kind: "payment-failed", ...order },
        { ...origins, storefrontOrigin: "https://evil.example" },
      ),
    ).toThrow("Template link origin is not allowed");
    expect(() =>
      renderTemplate(
        { kind: "payment-failed", ...order },
        { ...origins, allowedOrigins: ["https://shop.example.test/path"] },
      ),
    ).toThrow("Template link origin is not allowed");
    expect(() =>
      renderTemplate(
        { kind: "payment-failed", ...order, url: "https://evil.example" } as TemplateData,
        origins,
      ),
    ).toThrow();
  });

  test("summarizes a long receipt and handles missing shipment details", () => {
    const items = Array.from({ length: 25 }, (_, index) => ({
      name: `Item ${index + 1}`,
      quantity: 1,
      unitPriceMinor: 100,
    }));
    const receipt = renderTemplate(
      { kind: "order-confirmation", ...order, currency: "USD", totalMinor: 2500, items },
      origins,
    );
    expect(receipt.text).toContain("And 5 more items");
    expect(receipt.text).not.toContain("Item 21");
    const shipped = renderTemplate({ kind: "order-shipped", ...order }, origins);
    expect(shipped.text).not.toContain("Carrier:");
    expect(shipped.text).not.toContain("Tracking number:");
  });
});
