import { NotImplementedException, ServiceUnavailableException } from "@nestjs/common";
import { PaymentsService } from "./payments.service";

describe("payment creation kill switch", () => {
  const original = process.env.PAYMENTS_ENABLED;
  const originalMode = process.env.NODE_ENV;
  const service = new PaymentsService();
  afterEach(() => {
    if (original === undefined) delete process.env.PAYMENTS_ENABLED;
    else process.env.PAYMENTS_ENABLED = original;
    process.env.NODE_ENV = originalMode;
  });

  it("returns 503 PAYMENTS_DISABLED before attempting payment creation", () => {
    process.env.PAYMENTS_ENABLED = "false";
    try {
      service.createPaymentIntent();
      fail("Expected the payment kill switch to deny creation");
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect((error as ServiceUnavailableException).getStatus()).toBe(503);
      expect((error as ServiceUnavailableException).getResponse()).toMatchObject({
        code: "PAYMENTS_DISABLED",
      });
    }
  });

  it("preserves the existing stub when payments are enabled", () => {
    process.env.PAYMENTS_ENABLED = "true";
    expect(() => service.createPaymentIntent()).toThrow(NotImplementedException);
  });

  it("defaults off outside test mode and on in test mode", () => {
    delete process.env.PAYMENTS_ENABLED;
    process.env.NODE_ENV = "production";
    expect(() => service.createPaymentIntent()).toThrow(ServiceUnavailableException);
    process.env.NODE_ENV = "test";
    expect(() => service.createPaymentIntent()).toThrow(NotImplementedException);
  });
});
