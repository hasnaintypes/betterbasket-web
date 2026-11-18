# User JWT verification

Downstream services set `AUTH_ISSUER` to the public API origin used by auth-service, `AUTH_AUDIENCE` to the configured JWT audience (defaults to the issuer when omitted), and `AUTH_JWKS_URL` to the private auth-service JWKS endpoint. All three values are independent of the gateway's `AUTH_SERVICE_URL` routing target. The issuer and JWKS URL are required; there is no localhost fallback.

`JwksVerifier` accepts `{ issuer, audience, jwksUrl, cacheMaxAgeMs?, cooldownMs? }`. It accepts only EdDSA user tokens, allows five seconds of clock skew, validates v2 claims, and caches JWKS responses for up to ten minutes by default. A token with an unknown `kid` triggers a refetch subject to JOSE's default 30-second cooldown. A removed key can remain accepted until the cache expires; rotate with an overlap of at least the token lifetime plus the cache window. The process-wide environment factory reuses one verifier and JWKS cache. Failed verification denies access; an expired token yields `TOKEN_EXPIRED`, while other failures yield `UNAUTHENTICATED`. Do not log tokens.

# Internal service authentication

Services use short lived HS256 tokens only for `/internal/*` routes. The gateway blocks those routes. User routes continue to use `@Auth()` and JWKS verified user tokens.

Set `INTERNAL_JWT_SECRETS` to a JSON object mapping each callee name to one or two `kid:secret` strings. Each secret must contain at least 32 UTF-8 bytes. Set `SERVICE_NAME` to the receiving service's name before constructing `InternalAuthGuard`. Missing or invalid configuration fails construction. Use a secret manager to inject these values; do not commit real secrets.

```text
INTERNAL_JWT_SECRETS={"order-service":["v2:<32-or-more-secret-bytes>","v1:<32-or-more-secret-bytes>"]}
SERVICE_NAME=order-service
```

On the receiving route, use `@Internal()` under `/internal/*`. The guard checks the route path, signature, audience, token type, issued time, expiry, and key ID. It attaches validated claims to `request.service`. A caller creates `new InternalTokenSigner("seller-service")`, then `new InternalHttpClient(signer, "order-service", orderServiceUrl)` and calls `client.request("/internal/price", { method: "GET" }, requestId)`. The client signs every call, times out after two seconds, and retries a connect error or 5xx once for idempotent methods. POST calls are never retried.

For rotation, distribute the new key to every receiver as the first array item while retaining the old key second. Update every caller to the new list; signers always select the first key. After all callers have switched and at least 60 seconds plus the five second clock tolerance have elapsed, remove the old key from receivers. Keep at most two active keys per audience and use distinct key IDs.
