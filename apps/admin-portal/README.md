# Admin portal app

Set `NEXT_PUBLIC_API_URL` to the gateway origin (`http://localhost:4000` for
local development). The shell provides Query and session context, accessible
loading and error states, and a retry action when the gateway is unavailable.
API tokens stay in memory.

The app sends `X-Robots-Tag: noindex, nofollow` and `X-Frame-Options: DENY`.
Its nonce-based CSP is report-only while violations are reviewed. Scripts do
not permit `unsafe-inline`; Tailwind currently needs that exception for styles.
