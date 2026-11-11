# User JWT verification

Downstream services verify user JWTs with `JwksVerifier` or `@Auth()` using three separate settings:

```text
AUTH_ISSUER=https://api.betterbasket.app
AUTH_AUDIENCE=https://api.betterbasket.app
AUTH_JWKS_URL=https://auth.internal.betterbasket.app/api/auth/jwks
```

`AUTH_ISSUER` is the public API origin configured as auth-service's `BASE_URL`. `AUTH_AUDIENCE` defaults to that issuer when omitted. `AUTH_JWKS_URL` must point to the private JWKS endpoint. No localhost fallback is used. The gateway's `AUTH_SERVICE_URL` remains its upstream routing setting.

The verifier accepts EdDSA only, allows five seconds of clock skew, and validates the v2 claims. Its remote JWKS client is shared per process. jose caches keys for ten minutes by default and limits refetches to one per thirty seconds; an unknown key triggers a refetch after that cooldown. A token whose key cannot be found or refreshed is rejected. A removed key may remain accepted in cache for up to ten minutes, so emergency key revocation must account for that window. Verification failures return `TOKEN_EXPIRED` for expired tokens and `UNAUTHENTICATED` otherwise, without exposing token or provider details.

For direct construction, pass `new JwksVerifier({ issuer, audience, jwksUrl })`. Tests may override `cacheMaxAgeMs` and `cooldownMs` to exercise rotation without waiting for production timeouts.

# Internal service authentication

Services use short lived HS256 tokens only for `/internal/*` routes. The gateway blocks those routes. User routes continue to use `@Auth()` and JWKS verified user tokens.

Set `INTERNAL_JWT_SECRETS` to a JSON object mapping each callee name to one or two `kid:secret` strings. Each secret must contain at least 32 UTF-8 bytes. Set `SERVICE_NAME` to the receiving service's name before constructing `InternalAuthGuard`. Missing or invalid configuration fails construction. Use a secret manager to inject these values; do not commit real secrets.

```text
INTERNAL_JWT_SECRETS={"order-service":["v2:<32-or-more-secret-bytes>","v1:<32-or-more-secret-bytes>"]}
SERVICE_NAME=order-service
```

On the receiving route, use `@Internal()` under `/internal/*`. The guard checks the route path, signature, audience, token type, issued time, expiry, and key ID. It attaches validated claims to `request.service`. A caller creates `new InternalTokenSigner("seller-service")`, then `new InternalHttpClient(signer, "order-service", orderServiceUrl)` and calls `client.request("/internal/price", { method: "GET" }, requestId)`. The client signs every call, times out after two seconds, and retries a connect error or 5xx once for idempotent methods. POST calls are never retried.

For rotation, distribute the new key to every receiver as the first array item while retaining the old key second. Update every caller to the new list; signers always select the first key. After all callers have switched and at least 60 seconds plus the five second clock tolerance have elapsed, remove the old key from receivers. Keep at most two active keys per audience and use distinct key IDs.
