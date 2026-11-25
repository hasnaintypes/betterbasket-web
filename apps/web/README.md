# Storefront app

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
result page checks the resulting session and offers sign-in if none exists;
whether verification should create that session is the open #26 scope decision.
