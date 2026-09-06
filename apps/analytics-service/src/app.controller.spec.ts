import { Test, type TestingModule } from "@nestjs/testing";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";

describe("AppController", () => {
  let controller: AppController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    controller = module.get(AppController);
  });

  describe("health", () => {
    it("returns ok status with the service name", () => {
      const result = controller.health();
      expect(result.status).toBe("ok");
      expect(typeof result.timestamp).toBe("string");
    });
  });
});
