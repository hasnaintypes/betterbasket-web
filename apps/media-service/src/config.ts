import { z } from "zod";
import { port, secret, url } from "@betterbasket/runtime";

export const mediaEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]),
  PORT: port(),
  AUTH_SERVICE_URL: url(),
  IMAGEKIT_PUBLIC_KEY: z.string().min(1),
  IMAGEKIT_PRIVATE_KEY: secret(),
  IMAGEKIT_URL_ENDPOINT: url(),
});
