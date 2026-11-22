# Notification service

The service consumes notification requests. Delivery wiring belongs to the later notification worker issue; this package currently provides pure transactional email rendering in `src/templates/`.

## Transactional templates

`renderTemplate(data, origins)` returns `{ subject, html, text }` for order confirmation and receipt, payment failure, shipment, delivery, cancellation, refund, seller new order, seller approval, and seller suspension. Its `TemplateDataSchema` validates the required fields and rejects unknown payload fields. Monetary amounts are integer USD cents. A receipt shows the first 20 items and summarizes any remaining items.

Pass trusted storefront and seller-portal HTTPS origins plus an explicit `allowedOrigins` list. The renderer builds links from those origins and fixed application paths; event payloads cannot supply link destinations. React escapes payload text in HTML, and the plain-text alternative removes control characters from individual lines. The templates use text rather than decorative images and dark text on a white background.

```ts
import { renderTemplate } from "./src/templates";

const message = renderTemplate(
  { kind: "payment-failed", orderId: "order_123", customerName: "Ada" },
  {
    storefrontOrigin: "https://shop.example.test",
    sellerPortalOrigin: "https://seller.example.test",
    allowedOrigins: ["https://shop.example.test", "https://seller.example.test"],
  },
);
```

Run `pnpm --filter notification-service test` for all nine snapshots and security and edge-case checks. No provider send occurs when rendering.
