# API Documentation

Each service publishes its own OpenAPI 3 spec via `@nestjs/swagger`:

| Service | Local Swagger UI |
|---|---|
| gateway | http://localhost:4000/docs |
| auth-service | http://localhost:4001/docs (auth endpoints themselves are under `/api/auth/*`, documented at https://www.better-auth.com/docs) |
| product-service | http://localhost:4002/docs |
| seller-service | http://localhost:4003/docs |
| order-service | http://localhost:4004/docs |
| payment-service | http://localhost:4005/docs |
| notification-service | http://localhost:4006/docs |
| media-service | http://localhost:4007/docs |
| analytics-service | http://localhost:4008/docs |

## Aggregated portal (planned, Tier 2+)

Once there are enough real endpoints across services to be worth browsing in
one place, this folder will hold:

- `openapi/<service>.json` — exported specs (`nest-cli` + a small export
  script per service, or fetched from each `/docs-json` endpoint in CI).
- A [Scalar](https://scalar.com) or [Redocly](https://redocly.com) config
  that merges them into a single browsable site, deployed alongside the
  gateway at `/docs` or as its own static page.

Not built yet — tracked in `docs/PRD.md` Tier 2.
