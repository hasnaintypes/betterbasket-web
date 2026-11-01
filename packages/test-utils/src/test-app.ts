import type { Type } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import supertest from "supertest";

export async function createTestApp(module: Type<unknown>): Promise<{
  app: INestApplication;
  request: ReturnType<typeof supertest>;
  close: () => Promise<void>;
}> {
  const testingModule = await Test.createTestingModule({ imports: [module] }).compile();
  const app = testingModule.createNestApplication();
  await app.init();
  return { app, request: supertest(app.getHttpServer()), close: () => app.close() };
}
