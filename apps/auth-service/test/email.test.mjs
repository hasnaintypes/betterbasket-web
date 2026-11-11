import assert from "node:assert/strict";
import { test } from "node:test";
import { createEmailDelivery } from "../dist/email/delivery.js";
import { ResendEmailSender } from "../dist/email/sender.js";

test("email delivery allows only configured non-production recipients and fixes callback origins", async () => {
  const messages = [];
  const delivery = createEmailDelivery(
    {
      async send(message) {
        messages.push(message);
      },
    },
    {
      apiUrl: "https://api.example.test",
      webUrl: "https://shop.example.test",
      nodeEnv: "development",
      allowedRecipients: ["allowed@example.test"],
    },
  );
  delivery.enqueue(
    "verification",
    "allowed@example.test",
    "safe-token",
    "https://api.example.test/api/auth/verify-email?token=safe-token&callbackURL=https%3A%2F%2Fevil.example",
  );
  delivery.enqueue(
    "password-reset",
    "other@example.test",
    "blocked-token",
    "https://api.example.test/reset",
  );
  delivery.enqueue(
    "verification",
    "allowed@example.test",
    "bad-token",
    "https://evil.example/verify",
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(messages.length, 1);
  assert.equal(messages[0].to, "allowed@example.test");
  assert.equal(
    messages[0].link,
    "https://api.example.test/api/auth/verify-email?token=safe-token&callbackURL=https%3A%2F%2Fshop.example.test%2Femail-verified",
  );
});

test("Resend uses a stable idempotency key and never logs message secrets", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (_url, options) => {
    requests.push(options);
    return new Response("{}", { status: 200 });
  };
  try {
    const sender = new ResendEmailSender("re_test_key", "BetterBasket <sender@example.test>");
    const message = {
      kind: "password-reset",
      to: "user@example.test",
      token: "reset-secret",
      link: "https://api.example.test/reset?token=reset-secret",
    };
    await sender.send(message);
    await sender.send(message);
    assert.equal(requests.length, 2);
    assert.equal(requests[0].headers["Idempotency-Key"], requests[1].headers["Idempotency-Key"]);
    assert.equal(requests[0].headers.Authorization, "Bearer re_test_key");
    assert.match(requests[0].body, /reset-secret/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
