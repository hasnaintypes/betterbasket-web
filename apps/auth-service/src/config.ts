import { config as loadDotEnv } from "dotenv";
import { z } from "zod";
import { bool, csv, loadConfig, port } from "@betterbasket/runtime";

const origin = z.url().refine((value) => {
  const parsed = new URL(value);
  return (
    ["http:", "https:"].includes(parsed.protocol) && parsed.origin === value.replace(/\/$/, "")
  );
});

const databaseUrl = z.url().refine((value) => {
  const parsed = new URL(value);
  return (
    ["postgres:", "postgresql:"].includes(parsed.protocol) &&
    Boolean(parsed.hostname && parsed.username && parsed.password && parsed.pathname.slice(1))
  );
});

export const authEnvSchema = z.object({
  PORT: port(),
  NODE_ENV: z.enum(["development", "test", "production"]),
  ENABLE_DOCS: bool(),
  GIT_SHA: z.string().min(1),
  BASE_URL: origin,
  TRUSTED_ORIGINS: csv().pipe(z.array(origin)),
  BETTER_AUTH_SECRET: z
    .string()
    .refine(
      (value) =>
        Buffer.byteLength(value, "utf8") >= 32 && !/changeme|change-me|placeholder/i.test(value),
    ),
  DATABASE_URL: databaseUrl,
  WEB_URL: origin,
  RESEND_API_KEY: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z
      .string()
      .min(1)
      .refine((value) => !/placeholder|changeme/i.test(value))
      .optional(),
  ),
  EMAIL_FROM: z.string().regex(/^[^<>]+ <[^<>@\s]+@[^<>@\s]+>$/),
  EMAIL_ALLOWED_RECIPIENTS: z
    .string()
    .transform((value) =>
      value
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.email())),
});

const validatedAuthEnvSchema = authEnvSchema.superRefine((value, ctx) => {
  if (!value.TRUSTED_ORIGINS.includes(value.WEB_URL)) {
    ctx.addIssue({ code: "custom", path: ["WEB_URL"], message: "WEB_URL must be trusted" });
  }
  if (value.NODE_ENV === "production" && !value.RESEND_API_KEY) {
    ctx.addIssue({ code: "custom", path: ["RESEND_API_KEY"], message: "Required in production" });
  }
});

export function getAuthConfig() {
  loadDotEnv({ path: `.env.${process.env.NODE_ENV ?? "development"}` });
  return loadConfig(validatedAuthEnvSchema);
}
