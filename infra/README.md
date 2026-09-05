# infra/

This folder holds **deployment** config only — Railway/Render service
manifests, and anything else needed to ship a built container. It does
**not** contain local dev infrastructure.

## Local development uses real cloud services, not Docker

Every datastore/broker is a managed, free-tier cloud service reachable
directly from your machine. Dev and prod are simply different
projects/clusters on the same providers — see [`docs/infra-setup.md`](../docs/infra-setup.md)
for account setup and where each connection string goes.

| Concern | Provider | Why |
|---|---|---|
| Postgres (auth, seller, order, payment) | [Neon](https://neon.tech) | Serverless Postgres, instant branching (one branch per environment), generous free tier |
| MongoDB (product catalog) | [MongoDB Atlas](https://www.mongodb.com/atlas) | Free M0 cluster covers dev; dedicated cluster for prod |
| Redis (cache/sessions/rate-limit) | [Upstash Redis](https://upstash.com) | Serverless, REST + TCP, free tier, no server to run |
| Kafka (event bus) | [Redpanda Cloud Serverless](https://redpanda.com/redpanda-cloud) | Kafka-API compatible, free tier, no local broker to install |

Each `apps/<service>/.env.development.example` and
`.env.production.example` lists the exact env vars to fill in from these
dashboards.

## What's actually in this folder

- `apps/<service>/Dockerfile` (colocated with each service) — used by CI to
  build the image that Railway/Render deploys. This is the one legitimate
  use of Docker in this project: build-time, not local dev.
- Railway/Render service manifests (added as each service is deployed).
