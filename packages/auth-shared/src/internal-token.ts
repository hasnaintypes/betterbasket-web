import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const NAME = /^[a-z][a-z0-9-]*$/;
const KID = /^[A-Za-z0-9_-]+$/;
const claimsSchema = z.strictObject({
  iss: z.string().regex(NAME),
  aud: z.string().regex(NAME),
  typ: z.literal("svc"),
  iat: z.number().int(),
  exp: z.number().int(),
  jti: z.string().uuid(),
});

export type InternalTokenClaims = z.infer<typeof claimsSchema>;
export type InternalSecrets = Readonly<Record<string, readonly { kid: string; secret: string }[]>>;

/** INTERNAL_JWT_SECRETS is a JSON object of audience -> ["kid:secret", ...]. */
export function parseInternalSecrets(value: string | undefined): InternalSecrets {
  if (!value) throw new Error("INTERNAL_JWT_SECRETS is required");
  let input: unknown;
  try {
    input = JSON.parse(value);
  } catch {
    throw new Error("INTERNAL_JWT_SECRETS must be valid JSON");
  }
  const entries = z.record(z.string().regex(NAME), z.array(z.string()).min(1).max(2)).parse(input);
  if (Object.keys(entries).length === 0) throw new Error("INTERNAL_JWT_SECRETS is empty");
  return Object.fromEntries(
    Object.entries(entries).map(([audience, pairs]) => {
      const secrets = pairs.map((pair) => {
        const separator = pair.indexOf(":");
        const kid = pair.slice(0, separator);
        const secret = pair.slice(separator + 1);
        if (separator < 1 || !KID.test(kid) || Buffer.byteLength(secret, "utf8") < 32)
          throw new Error(`Invalid internal secret for ${audience}`);
        return { kid, secret };
      });
      if (new Set(secrets.map(({ kid }) => kid)).size !== secrets.length)
        throw new Error(`Duplicate internal key ID for ${audience}`);
      return [audience, secrets];
    }),
  );
}

const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
const signature = (data: string, secret: string) =>
  createHmac("sha256", secret).update(data).digest();

export class InternalTokenSigner {
  constructor(
    private readonly issuer: string,
    private readonly secrets: InternalSecrets = parseInternalSecrets(
      process.env.INTERNAL_JWT_SECRETS,
    ),
  ) {
    if (!NAME.test(issuer)) throw new Error("Invalid internal issuer");
  }

  sign(audience: string): string {
    const key = this.secrets[audience]?.[0];
    if (!key) throw new Error(`No internal secret configured for ${audience}`);
    const now = Math.floor(Date.now() / 1000);
    const data = `${encode({ alg: "HS256", typ: "JWT", kid: key.kid })}.${encode({
      iss: this.issuer,
      aud: audience,
      typ: "svc",
      iat: now,
      exp: now + 60,
      jti: randomUUID(),
    })}`;
    return `${data}.${signature(data, key.secret).toString("base64url")}`;
  }
}

export class InternalTokenVerifier {
  constructor(
    private readonly audience: string,
    private readonly secrets: InternalSecrets = parseInternalSecrets(
      process.env.INTERNAL_JWT_SECRETS,
    ),
  ) {
    if (!NAME.test(audience) || !secrets[audience])
      throw new Error(`No internal secret configured for ${audience}`);
  }

  verify(token: string): InternalTokenClaims {
    const parts = token.split(".");
    if (parts.length !== 3) throw new Error("Invalid internal token");
    const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];
    let header: unknown;
    let payload: unknown;
    let supplied: Buffer;
    try {
      header = JSON.parse(Buffer.from(headerPart, "base64url").toString("utf8"));
      payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"));
      supplied = Buffer.from(signaturePart, "base64url");
    } catch {
      throw new Error("Invalid internal token");
    }
    const parsedHeader = z
      .strictObject({ alg: z.literal("HS256"), typ: z.literal("JWT"), kid: z.string().regex(KID) })
      .parse(header);
    const key = this.secrets[this.audience]?.find(({ kid }) => kid === parsedHeader.kid);
    if (!key) throw new Error("Unknown internal key");
    const expected = signature(`${headerPart}.${payloadPart}`, key.secret);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
      throw new Error("Invalid internal signature");
    const claims = claimsSchema.parse(payload);
    const now = Math.floor(Date.now() / 1000);
    if (
      claims.aud !== this.audience ||
      claims.iat > now + 5 ||
      claims.exp <= now - 5 ||
      claims.exp <= claims.iat ||
      claims.exp - claims.iat > 60
    )
      throw new Error("Invalid internal claims");
    return claims;
  }
}
