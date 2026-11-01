import { Test } from "@nestjs/testing";
import { AppModule } from "./app.module";
import { GATEWAY_CONFIG, type GatewayConfig } from "./config";
import { ServiceRegistry } from "./proxy/service-registry";

const testConfig = {
  NODE_ENV: "test",
  PORT: "4000",
  CORS_ALLOWED_ORIGINS: "http://localhost:3000",
  AUTH_SERVICE_URL: "http://localhost:4001",
  PRODUCT_SERVICE_URL: "http://localhost:4002",
  SELLER_SERVICE_URL: "http://localhost:4003",
  ORDER_SERVICE_URL: "http://localhost:4004",
  PAYMENT_SERVICE_URL: "http://localhost:4005",
  NOTIFICATION_SERVICE_URL: "http://localhost:4006",
  MEDIA_SERVICE_URL: "http://localhost:4007",
  ANALYTICS_SERVICE_URL: "http://localhost:4008",
};

describe("gateway configuration", () => {
  const previous = { ...process.env };
  afterEach(() => {
    process.env = { ...previous };
  });

  it("boots with validated test configuration and injects proxy targets", async () => {
    Object.assign(process.env, testConfig);
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    try {
      const config = module.get<GatewayConfig>(GATEWAY_CONFIG);
      expect(config.PORT).toBe(4000);
      expect(config.CORS_ALLOWED_ORIGINS).toEqual(["http://localhost:3000"]);
      expect(Object.isFrozen(config)).toBe(true);
      expect(module.get(ServiceRegistry).auth).toBe(testConfig.AUTH_SERVICE_URL);
    } finally {
      await module.close();
    }
  });
});
