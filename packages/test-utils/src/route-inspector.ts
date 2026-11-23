import type { Type } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { CAPABILITY_KEY, INTERNAL_KEY, PUBLIC_KEY } from "@betterbasket/auth-shared";

/** Checks Nest HTTP handlers before a service is considered covered by authorization tests. */
export function assertRoutesDeclared(controllers: Type<unknown>[]): void {
  const missing: string[] = [];
  for (const controller of controllers) {
    const prototype = controller.prototype as Record<string, unknown>;
    for (const name of Object.getOwnPropertyNames(prototype)) {
      if (name === "constructor") continue;
      const handler = prototype[name];
      if (typeof handler !== "function") continue;
      const method = Reflect.getMetadata(METHOD_METADATA, handler) as number | undefined;
      if (method === undefined) continue;
      const isPublic =
        Reflect.getMetadata(PUBLIC_KEY, handler) ?? Reflect.getMetadata(PUBLIC_KEY, controller);
      const capability =
        Reflect.getMetadata(CAPABILITY_KEY, handler) ??
        Reflect.getMetadata(CAPABILITY_KEY, controller);
      const isInternal =
        Reflect.getMetadata(INTERNAL_KEY, handler) ?? Reflect.getMetadata(INTERNAL_KEY, controller);
      if (isPublic !== true && isInternal !== true && !capability) {
        const base = Reflect.getMetadata(PATH_METADATA, controller) as string | undefined;
        const path = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
        missing.push(`${controller.name}.${name} /${[base, path].filter(Boolean).join("/")}`);
      }
    }
  }
  if (missing.length)
    throw new Error(`Routes without @Public or @Capability: ${missing.join(", ")}`);
}
