import { z } from "zod";
import { writeSync } from "node:fs";

export function url() {
  return z.url().refine((value) => /^https?:\/\//.test(value));
}

export function secret(minLength = 16) {
  return z
    .string()
    .trim()
    .min(minLength)
    .refine((value) => !/changeme|placeholder/i.test(value));
}

export function csv() {
  return z
    .string()
    .transform((value) => value.split(",").map((part) => part.trim()))
    .pipe(z.array(z.string().min(1)).min(1));
}

export function bool() {
  return z.enum(["true", "false"]).transform((value) => value === "true");
}

export function port() {
  return z
    .string()
    .regex(/^[0-9]+$/)
    .transform(Number)
    .pipe(z.number().int().min(1).max(65535));
}

function freezeDeep<T>(value: T): Readonly<T> {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

export function loadConfig<T extends z.ZodType>(
  schema: T,
  source: NodeJS.ProcessEnv = process.env,
): Readonly<z.output<T>> {
  const result = schema.safeParse(source);
  if (!result.success) {
    const names = [
      ...new Set(result.error.issues.map((issue) => String(issue.path[0] ?? "configuration"))),
    ].sort();
    writeSync(2, `Invalid configuration: ${names.join(", ")}\n`);
    process.exit(1);
  }
  return freezeDeep(result.data);
}

export { AllExceptionsFilter } from "./http/all-exceptions.filter";
export {
  RequestIdMiddleware,
  REQUEST_LOGGER,
  getRequestId,
  getRequestLogger,
  acceptedRequestId,
} from "./http/request-id.middleware";
export { ZodValidationPipe } from "./http/zod-validation.pipe";
