# @betterbasket/test-utils

Shared helpers for local unit and integration tests. Add this package only as a `devDependency`; production source imports are blocked by the shared ESLint config.

```ts
import {
  createStubUpstream,
  createJwtTestIssuer,
  createTestApp,
  buildUser,
  createTestClock,
} from "@betterbasket/test-utils";
```

- `createStubUpstream()` listens on `127.0.0.1` at an ephemeral port. `enqueue({ status, headers, body })` scripts the next response. `requests` records each method, URL, headers, raw body, and SHA-256 hex digest. `onUpgrade(handler)` handles HTTP upgrades; without a handler, upgrade sockets are closed.
- `createJwtTestIssuer()` creates a fresh in-memory Ed25519 key pair and an ephemeral JWKS endpoint. `sign(claims)` creates a short-lived token compatible with `JwksVerifier` using v2 claims. Keys are never stored on disk.
- `createTestApp(ModuleClass)` initializes a Nest app and provides `app`, a Supertest `request`, and `close()`.
- `buildUser`, `buildSeller`, `buildProduct`, and `buildOrder` return synthetic contract-shaped fixtures and accept field overrides.
- `createTestClock(initial?)` provides `now()`, `advanceBy(milliseconds)`, and `set(date)` without changing global time.

Always call `close()` for servers and Nest apps in `afterAll` or `finally` to prevent open handles. The helpers need no cloud services or Docker.

Nest services can use the shared Jest preset with `module.exports = require("@betterbasket/config/jest")(__dirname)`. Pass `"swc"` as the second argument when the service has `@swc/core` and `@swc/jest` installed. The preset keeps legacy decorators and decorator metadata enabled for Nest. The gateway uses SWC after a cold run of its spec took 55.91 seconds with `ts-jest` and 22.06 seconds with SWC (both `--runInBand --no-cache`, wall time).
