import type { INestApplication, LoggerService, Type } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { createLogger, type Logger } from "@betterbasket/logger";
import type { Express, NextFunction, Request, Response } from "express";
import { AllExceptionsFilter } from "../http/all-exceptions.filter";
import { RequestIdMiddleware } from "../http/request-id.middleware";

export type ReadinessCheck = () => boolean | Promise<boolean>;

export class ReadinessRegistry {
  private readonly checks = new Map<string, ReadinessCheck>();
  private shuttingDown = false;

  register(name: string, check: ReadinessCheck): void {
    if (this.checks.has(name)) throw new Error(`Readiness check already registered: ${name}`);
    this.checks.set(name, check);
  }

  beginShutdown(): void {
    this.shuttingDown = true;
  }

  async status(): Promise<{ ready: boolean; checks: Record<string, boolean> }> {
    const checks: Record<string, boolean> = {};
    for (const [name, check] of this.checks) {
      try {
        checks[name] = (await check()) === true;
      } catch {
        checks[name] = false;
      }
    }
    return { ready: !this.shuttingDown && Object.values(checks).every(Boolean), checks };
  }
}

const registries = new WeakMap<INestApplication, ReadinessRegistry>();

export function getReadinessRegistry(app: INestApplication): ReadinessRegistry {
  const registry = registries.get(app);
  if (!registry) throw new Error("Service has not been bootstrapped");
  return registry;
}

class PinoNestLogger implements LoggerService {
  constructor(private readonly logger: Logger) {}
  log(message: unknown, context?: string): void {
    this.logger.info({ context }, String(message));
  }
  error(message: unknown, trace?: string, context?: string): void {
    this.logger.error({ context, trace }, String(message));
  }
  warn(message: unknown, context?: string): void {
    this.logger.warn({ context }, String(message));
  }
  debug(message: unknown, context?: string): void {
    this.logger.debug({ context }, String(message));
  }
  verbose(message: unknown, context?: string): void {
    this.logger.trace({ context }, String(message));
  }
}

export interface BootstrapServiceOptions {
  bodyParser?: boolean;
  rawBody?: boolean;
  beforeInit?: (app: INestApplication) => void | Promise<void>;
  swagger?: { title: string; description: string; version: string };
}

export interface BootstrapServiceArgs {
  module: Type<unknown>;
  name: string;
  port: number | ((app: INestApplication) => number);
  options?: BootstrapServiceOptions;
}

export async function bootstrapService({
  module,
  name,
  port,
  options = {},
}: BootstrapServiceArgs): Promise<INestApplication> {
  const logger = createLogger({ service: name });
  const app = await NestFactory.create(module, {
    cors: false,
    bodyParser: options.bodyParser,
    rawBody: options.rawBody,
    logger: false,
  });
  app.useLogger(new PinoNestLogger(logger));
  const middleware = new RequestIdMiddleware(logger);
  app.use((req: Request, res: Response, next: NextFunction) => middleware.use(req, res, next));
  app.useGlobalFilters(new AllExceptionsFilter(logger));

  const registry = new ReadinessRegistry();
  registries.set(app, registry);
  const expressApp = app.getHttpAdapter().getInstance() as Express;
  expressApp.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      service: name,
      timestamp: new Date().toISOString(),
      version: process.env.GIT_SHA ?? "unknown",
    });
  });
  expressApp.get("/ready", async (_req, res) => {
    const { ready, checks } = await registry.status();
    res
      .status(ready ? 200 : 503)
      .json({ status: ready ? "ok" : "not_ready", service: name, checks });
  });

  await options.beforeInit?.(app);
  if (
    options.swagger &&
    (process.env.NODE_ENV !== "production" || process.env.ENABLE_DOCS === "true")
  ) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle(options.swagger.title)
        .setDescription(options.swagger.description)
        .setVersion(options.swagger.version)
        .addBearerAuth()
        .build(),
    );
    SwaggerModule.setup("docs", app, document);
  }
  await app.init();
  const onSignal = () => registry.beginShutdown();
  process.once("SIGTERM", onSignal);
  app.enableShutdownHooks();
  await app.listen(typeof port === "function" ? port(app) : port, "0.0.0.0");
  app.getHttpServer().once("close", () => process.off("SIGTERM", onSignal));
  const address = app.getHttpServer().address();
  logger.info({ port: typeof address === "object" ? address?.port : port }, "service listening");
  return app;
}
