import "reflect-metadata";
import { createRequire } from "node:module";
import pino from "pino";
import { z } from "zod";

const require = createRequire(import.meta.url);
const {
  Body,
  Controller,
  Get,
  Module,
  Post,
  BadRequestException,
  HttpException,
} = require("@nestjs/common");
const { APP_FILTER } = require("@nestjs/core");
const {
  AllExceptionsFilter,
  RequestIdMiddleware,
  REQUEST_LOGGER,
  ZodValidationPipe,
} = require("../dist/index.js");

export const logLines = [];
const logger = pino({ level: "error" }, { write: (line) => logLines.push(JSON.parse(line)) });

class SampleController {
  validate(body) {
    return body;
  }
  crash() {
    throw new Error("server-secret-stack-marker");
  }
  badRequest() {
    throw new BadRequestException("raw-secret-marker");
  }
  upstream() {
    throw new HttpException("<html>raw upstream error</html>", 502);
  }
  zodError() {
    z.object({ code: z.string() }).parse({ code: 1 });
  }
}

Controller("sample")(SampleController);
Post("validate")(
  SampleController.prototype,
  "validate",
  Object.getOwnPropertyDescriptor(SampleController.prototype, "validate"),
);
Body(new ZodValidationPipe(z.object({ items: z.array(z.object({ name: z.string().min(1) })) })))(
  SampleController.prototype,
  "validate",
  0,
);
for (const [name, path] of [
  ["crash", "crash"],
  ["badRequest", "bad-request"],
  ["upstream", "upstream"],
  ["zodError", "zod-error"],
]) {
  Get(path)(
    SampleController.prototype,
    name,
    Object.getOwnPropertyDescriptor(SampleController.prototype, name),
  );
}

class SampleModule {
  configure(consumer) {
    consumer.apply(RequestIdMiddleware).forRoutes("*");
  }
}

Module({
  controllers: [SampleController],
  providers: [
    { provide: REQUEST_LOGGER, useValue: logger },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})(SampleModule);

export { SampleModule, logger };
