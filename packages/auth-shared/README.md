# User JWT verification

Downstream services set `AUTH_ISSUER` to the public API origin used by auth-service, `AUTH_AUDIENCE` to the configured JWT audience (defaults to the issuer when omitted), and `AUTH_JWKS_URL` to the private auth-service JWKS endpoint. All three values are independent of the gateway's `AUTH_SERVICE_URL` routing target. The issuer and JWKS URL are required; there is no localhost fallback.

`JwksVerifier` accepts `{ issuer, audience, jwksUrl, cacheMaxAgeMs?, cooldownMs? }`. It accepts only EdDSA user tokens, allows five seconds of clock skew, validates v2 claims, and caches JWKS responses for up to ten minutes by default. A token with an unknown `kid` triggers a refetch subject to JOSE's default 30-second cooldown. A removed key can remain accepted until the cache expires; rotate with an overlap of at least the token lifetime plus the cache window. The process-wide environment factory reuses one verifier and JWKS cache. Failed verification denies access; an expired token yields `TOKEN_EXPIRED`, while other failures yield `UNAUTHENTICATED`. Do not log tokens.

# Internal service authentication

Services use short lived HS256 tokens only for `/internal/*` routes. The gateway blocks those routes. User routes use global `JwtAuthGuard` and `CapabilityGuard` registered by `bootstrapService`.

Every user-facing Nest HTTP handler must declare `@Public()` or one `@Capability("name")`. The JWT guard runs before the capability guard. Missing metadata is denied. A public handler accepts anonymous requests and attaches `request.user` when a valid bearer token is supplied. The global guards do not apply to raw Express routes registered directly by the bootstrap helper or gateway proxy; those routes retain their own protection.
Routes under `/internal/*` use `@Internal()` instead; the internal token guard verifies those requests after the global user-token guards skip them.

```ts
@Get("catalog")
@Public()
listCatalog() {}

@Post("orders")
@Capability("order:create")
createOrder(@Req() request: AuthenticatedRequest) {}

@Post("products/:id/publish")
@Capability("product:publish")
@HighRisk()
publish(@Req() request: AuthenticatedRequest) {}
```

`order:create`, `order:read-own`, and `payment:create` require a verified email for customers and admins. `seller:register` permits a verified owner to create the initial pending seller for the active organization; a verified user with no active organization reaches the controller for an actionable 400 response. It does not grant access to an existing seller. `admin:*` requires `platformRole: "admin"`. All other seller capabilities are denied by the default `DenyingSellerAccessProvider` until the seller access service is implemented. A replacement `CapabilityResolver` can be supplied through `bootstrapService({ options: { capabilityResolver } })`; it should obtain seller access from a trusted service, fail closed on errors, and return a `sellerId` for `request.tenant`. `@HighRisk()` tells that provider to bypass any cache. Existing seller authorization is not derived from JWT `orgId` alone.

Set `INTERNAL_JWT_SECRETS` to a JSON object mapping each callee name to one or two `kid:secret` strings. Each secret must contain at least 32 UTF-8 bytes. Set `SERVICE_NAME` to the receiving service's name before constructing `InternalAuthGuard`. Missing or invalid configuration fails construction. Use a secret manager to inject these values; do not commit real secrets.

```text
INTERNAL_JWT_SECRETS={"order-service":["v2:<32-or-more-secret-bytes>","v1:<32-or-more-secret-bytes>"]}
SERVICE_NAME=order-service
```

On the receiving route, use `@Internal()` under `/internal/*`. The guard checks the route path, signature, audience, token type, issued time, expiry, and key ID. It attaches validated claims to `request.service`. A caller creates `new InternalTokenSigner("seller-service")`, then `new InternalHttpClient(signer, "order-service", orderServiceUrl)` and calls `client.request("/internal/price", { method: "GET" }, requestId)`. The client signs every call, times out after two seconds, and retries a connect error or 5xx once for idempotent methods. POST calls are never retried.

For rotation, distribute the new key to every receiver as the first array item while retaining the old key second. Update every caller to the new list; signers always select the first key. After all callers have switched and at least 60 seconds plus the five second clock tolerance have elapsed, remove the old key from receivers. Keep at most two active keys per audience and use distinct key IDs.
