# Storefront app

## Browse pages

`/` shows categories and new arrivals; `/products` supports category, price,
seller, search, sort, and pagination filters in the URL. The pages fetch public
catalog data through the gateway with `@betterbasket/api-client` and 60-second
revalidation. They show loading, empty, and recoverable error states. Product
images use ImageKit when available; other image hosts are not loaded. Set
`NEXT_PUBLIC_SITE_URL` to the storefront origin for canonical metadata, and
`NEXT_PUBLIC_API_URL` to the gateway origin. The gateway forwards
`/api/categories` to product-service.

The browse journey needs seeded, visible products in a nonproduction catalog
environment. Run the browser journey and record LCP before closing #76.
`pnpm --filter web test:e2e:catalog` runs a local Playwright journey against a
synthetic gateway stub and reports a local LCP sample. It uses the system
Chrome when available; set `PLAYWRIGHT_CHROME_PATH` for a different executable
or use a Playwright-installed Chromium. With `MONGODB_URI` set to a
nonproduction MongoDB connection, `pnpm --filter web test:e2e:catalog:seeded`
creates a random disposable database, seeds three visible products, checks
category and price filters through the local product service in Chrome, then
drops the database. Build product-service before running this test. Deployment
journey and LCP evidence remains required.

The storefront shell provides shared Query and session context, accessible
loading and error states, and a report-only nonce-based Content Security Policy.
Set `NEXT_PUBLIC_API_URL` to the gateway origin (`http://localhost:4000` for
local development). The browser session is checked through the gateway; API
tokens stay in memory. The shell shows a retry action if the gateway is
unavailable.

The CSP permits ImageKit images and Stripe scripts, frames, and API calls.
Scripts require a per-request nonce. Tailwind currently needs
`style-src 'unsafe-inline'`; this exception applies to styles only.

## Buyer account routes

`/sign-up` creates an email/password account; `/sign-in` accepts an optional
same-origin path in `returnTo` and falls back to `/` for external or ambiguous
targets. `/verify-email` resends a verification link, while the email sender
returns to `/email-verified` after a verification attempt. `/forgot-password`
requests a reset link, and `/reset-password` immediately removes the reset
token from browser history before using it. `/account` provides the buyer's
name, password change, session list and revocation, and sign-out.

The auth client uses `NEXT_PUBLIC_API_URL` for Better Auth's `/api/auth/*`
routes through the gateway. Account actions require that public origin to be
configured. Form inputs use strict shared Zod schemas. The email-verification
result page refreshes the session created by verification and links to the
account. If the session is unavailable, it offers a sign-in link.

Run `pnpm --filter web test:e2e:auth` with `AUTH_E2E_ADMIN_DATABASE_URL` set to
a nonproduction PostgreSQL connection that can create and drop databases. The
runner starts the local gateway and auth service, creates and migrates a random
disposable database, then drops it after the run. It uses synthetic accounts
and local secrets only; Chrome must be installed at `/usr/bin/google-chrome` or
supplied through `PLAYWRIGHT_CHROME_PATH`. The runner also checks the auth
pages for serious and critical accessibility violations.
