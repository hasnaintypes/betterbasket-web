# API client

`@betterbasket/api-client` sends typed JSON requests to the gateway origin in
`NEXT_PUBLIC_API_URL`. The client keeps its JWT in memory, obtains it from
`/api/auth/token` with the session cookie, and refreshes it when fewer than 60
seconds remain. Concurrent refreshes share one request. A 401 triggers one
refresh and retry. Call `api.clearToken()` after signing out to discard its
cached token. Session cookies are sent only to the token endpoint; data
requests use bearer authorization. Set `credentials: "include"` explicitly for
session endpoints such as `/api/auth/get-session`.

```ts
import { createApiClient, idempotencyKey } from "@betterbasket/api-client";
import { z } from "zod";

const api = createApiClient({ baseUrl: process.env.NEXT_PUBLIC_API_URL! });
const order = await api.post(
  "/orders",
  { items: [] },
  { idempotencyKey: idempotencyKey(), schema: z.object({ id: z.string() }) },
);
```

`get`, `post`, `patch`, and `delete` accept an optional response schema,
`AbortSignal`, and timeout override. The default timeout is 10 seconds. Use
`{ auth: false }` for public endpoints. Failed requests throw `ApiError` with
`code`, `message`, `requestId`, `details`, and `status`. Never store the JWT in
browser storage or put it in a URL. Give each new mutation its own idempotency
key; reuse the same key only to retry the same mutation body.
