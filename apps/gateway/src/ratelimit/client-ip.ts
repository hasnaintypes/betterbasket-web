import { isIP } from "node:net";

/** The rightmost forwarded address is added by the nearest trusted proxy. */
export function trustedClientIp(
  remoteAddress: string | undefined,
  forwardedFor: string | string[] | undefined,
  trustedHops: number,
): string {
  const remote = remoteAddress && isIP(remoteAddress) ? remoteAddress : "unknown";
  if (trustedHops === 0 || typeof forwardedFor !== "string") return remote;
  const chain = forwardedFor.split(",").map((value) => value.trim());
  const candidate = chain[chain.length - trustedHops];
  return candidate && isIP(candidate) ? candidate : remote;
}
