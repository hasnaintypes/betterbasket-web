/**
 * CLI-only entry point. The Better Auth CLI (`better-auth generate`,
 * `better-auth create-admin`) loads this file directly from TypeScript
 * source via its own loader — it does NOT go through our compiled CJS
 * `dist/` output, so a top-level `await` here is fine even though
 * `auth.config.ts`'s compiled output (consumed by `main.ts` via
 * `createAuth()`) has to stay CommonJS-safe (see the comment there).
 */
import { createAuth } from "./auth.config";

export const auth = await createAuth();
