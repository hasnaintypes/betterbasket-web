# ADR 0005: Vercel for frontends, Railway/Render for services

## Status
Accepted

## Context
We need independent deploys per app/service (see ADR 0001) without taking on
Kubernetes-level operational complexity for a project at this stage.

## Decision
- `web`, `seller-portal`, `admin-portal` → three separate **Vercel**
  projects, same repo, different "Root Directory" per project. Vercel's
  monorepo support + Turborepo remote cache handles this natively.
- Every backend service (`gateway`, `auth-service`, `product-service`,
  `seller-service`, `order-service`, `payment-service`,
  `notification-service`, `media-service`, `analytics-service`) → its own
  **Railway** (or Render) service, built from `apps/<service>/Dockerfile`.
- Service-to-service URLs are plain env vars (Railway/Render internal
  networking or public URLs) — see the "environment-variable based
  registry" note in `apps/gateway/src/proxy/service-registry.ts`. No
  Consul/etcd.
- CI (GitHub Actions) uses Turborepo's affected-package filter to decide
  which Docker images to rebuild/redeploy per push.

## Consequences
- Scaling a single hot service (e.g. `order-service` during a sale) doesn't
  require touching the others.
- Migration path to Kubernetes (EKS/GKE/DOKS) stays open later: the
  Dockerfiles and env-var-based service discovery already look like what
  you'd run in K8s — the only change would be swapping env-var URLs for
  K8s Service DNS names.
