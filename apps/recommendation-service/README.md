# recommendation-service (Tier 5 — not built yet)

Deferred per `docs/PRD.md` Tier 5. When this tier starts:

- **Stack:** FastAPI + TensorFlow (Python). Deliberately outside
  Turborepo's JS task graph (see ADR 0001) — this folder will get its own
  `pyproject.toml`/`uv.lock` and Dockerfile, invoked directly in CI rather
  than through `turbo run`.
- **Input:** consumes a `user.viewed-product.v1`-style Kafka event stream
  (to be added to `packages/contracts` when this tier starts) plus
  `product.created.v1`/`order.created.v1` for a basic collaborative-filtering
  model.
- **Output:** a `GET /recommendations/:userId` endpoint the gateway proxies
  to, consumed by `web`'s "recommended for you" section.

Do not add code here until Tier 1–4 are solid — see `docs/PRD.md`.
