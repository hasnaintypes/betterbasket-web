import pino, { type Logger } from "pino";

export interface CreateLoggerOptions {
  /** Service name, stamped on every log line so logs are filterable in aggregation (Axiom/Better Stack). */
  service: string;
  level?: "trace" | "debug" | "info" | "warn" | "error" | "fatal";
}

/**
 * Structured JSON logger shared by every NestJS service.
 * In dev (`NODE_ENV !== "production"`), pretty-prints to the terminal.
 */
export function createLogger({ service, level }: CreateLoggerOptions): Logger {
  const isProd = process.env.NODE_ENV === "production";

  return pino({
    name: service,
    level: level ?? process.env.LOG_LEVEL ?? "info",
    base: { service },
    transport: isProd
      ? undefined
      : {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "HH:MM:ss", ignore: "pid,hostname" },
        },
  });
}

export type { Logger };
