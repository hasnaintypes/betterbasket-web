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
