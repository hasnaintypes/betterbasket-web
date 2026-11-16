import { BadRequestException, PayloadTooLargeException } from "@nestjs/common";
import type { Request } from "express";
import { WebhookController } from "./webhook.controller";
import { StripeProcessorRegistry, StripeWebhookInbox } from "./webhook.inbox";

describe("webhook request guards", () => {
  const inbox = { receive: jest.fn().mockResolvedValue({ received: true }) };
  const controller = new WebhookController(inbox as unknown as StripeWebhookInbox);

  beforeEach(() => inbox.receive.mockClear());

  it("requires a raw body and signature before dispatch", async () => {
    expect(() => controller.handleAccount({} as Request, "signature")).toThrow(BadRequestException);
    expect(() =>
      controller.handleConnect({ rawBody: Buffer.from("{}") } as unknown as Request, undefined),
    ).toThrow(BadRequestException);
    expect(inbox.receive).not.toHaveBeenCalled();
  });

  it("rejects oversized bodies before verification", () => {
    expect(() =>
      controller.handleAccount(
        { rawBody: Buffer.alloc(1024 * 1024 + 1) } as unknown as Request,
        "signature",
      ),
    ).toThrow(PayloadTooLargeException);
    expect(inbox.receive).not.toHaveBeenCalled();
  });

  it("uses distinct account and connect scopes", async () => {
    const request = { rawBody: Buffer.from("{}") } as unknown as Request;
    await controller.handleAccount(request, "signature");
    await controller.handleConnect(request, "signature");
    expect(inbox.receive.mock.calls.map((call) => call[2])).toEqual(["account", "connect"]);
  });
});

describe("processor registry", () => {
  it("has no processors initially and rejects duplicate registrations", () => {
    const registry = new StripeProcessorRegistry();
    expect(registry.find("connect", "account.updated")).toBeUndefined();
    const processor = { scope: "connect" as const, type: "account.updated", process: jest.fn() };
    registry.register(processor);
    expect(registry.find("connect", "account.updated")).toBe(processor);
    expect(() => registry.register(processor)).toThrow("already registered");
  });
});
