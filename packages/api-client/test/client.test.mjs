import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { ApiError, createApiClient, idempotencyKey } from "../dist/index.js";

function jwt(exp) {
  return `e30.${Buffer.from(JSON.stringify({ exp })).toString("base64url")}.signature`;
}

test("ten concurrent requests share one token refresh and carry request IDs", async () => {
  let refreshes = 0;
  const calls = [];
  let now = 1_000_000;
  const fetchMock = async (url, init) => {
    if (url.endsWith("/api/auth/token")) {
      refreshes++;
      await new Promise((resolve) => setTimeout(resolve, 10));
      assert.equal(init.credentials, "include");
      return Response.json({ token: jwt((now + 300_000) / 1000) });
    }
    calls.push(init);
    return Response.json({ ok: true });
  };
  const client = createApiClient({
    baseUrl: "https://api.example.test",
    fetch: fetchMock,
    now: () => now,
  });
  await Promise.all(Array.from({ length: 10 }, () => client.get("/orders")));
  assert.equal(refreshes, 1);
  assert.equal(calls.length, 10);
  assert.equal(new Set(calls.map((call) => call.headers.get("X-Request-Id"))).size, 10);
  assert.ok(calls.every((call) => call.headers.get("Authorization")?.startsWith("Bearer ")));
  now += 250_000;
  await Promise.all(Array.from({ length: 10 }, () => client.get("/orders")));
  assert.equal(refreshes, 2);
  client.clearToken();
  await client.get("/orders");
  assert.equal(refreshes, 3);
});

test("one 401 retries after a fresh token, with the same request ID", async () => {
  let refreshes = 0;
  const requestIds = [];
  const fetchMock = async (url, init) => {
    if (url.endsWith("/api/auth/token")) {
      refreshes++;
      return Response.json({ token: jwt(Math.floor(Date.now() / 1000) + 300) });
    }
    requestIds.push(init.headers.get("X-Request-Id"));
    return requestIds.length === 1
      ? Response.json({ error: { code: "TOKEN_EXPIRED", message: "Expired" } }, { status: 401 })
      : Response.json({ ok: true });
  };
  const client = createApiClient({ baseUrl: "https://api.example.test", fetch: fetchMock });
  assert.deepEqual(await client.get("/orders"), { ok: true });
  assert.equal(refreshes, 2);
  assert.deepEqual(requestIds, [requestIds[0], requestIds[0]]);
});

test("sign-out invalidates an in-flight refresh without clearing a newer token", async () => {
  let finishOldRefresh;
  let refreshes = 0;
  const client = createApiClient({
    baseUrl: "https://api.example.test",
    fetch: async (url) => {
      if (url.endsWith("/api/auth/token")) {
        refreshes++;
        if (refreshes === 1) return new Promise((resolve) => (finishOldRefresh = resolve));
        return Response.json({ token: jwt(Math.floor(Date.now() / 1000) + 300) });
      }
      return Response.json({ ok: true });
    },
  });
  const oldRequest = client.get("/orders");
  client.clearToken();
  assert.deepEqual(await client.get("/orders"), { ok: true });
  finishOldRefresh(Response.json({ token: jwt(Math.floor(Date.now() / 1000) + 300) }));
  await assert.rejects(
    oldRequest,
    (error) => error instanceof ApiError && error.code === "UNAUTHENTICATED",
  );
  assert.deepEqual(await client.get("/orders"), { ok: true });
  assert.equal(refreshes, 2);
});

test("409 envelope maps to ApiError including request ID and safe details", async () => {
  const fetchMock = async () =>
    Response.json(
      {
        error: {
          code: "REQUEST_IN_PROGRESS",
          message: "Please retry",
          requestId: "a7b40be8-16b0-452c-9a48-7fc145091159",
          details: [{ field: "order", issue: "busy" }],
        },
      },
      { status: 409 },
    );
  const client = createApiClient({ baseUrl: "https://api.example.test", fetch: fetchMock });
  await assert.rejects(
    client.post("/orders", {}, { auth: false }),
    (error) =>
      error instanceof ApiError &&
      error.code === "REQUEST_IN_PROGRESS" &&
      error.status === 409 &&
      error.requestId === "a7b40be8-16b0-452c-9a48-7fc145091159" &&
      error.details[0]?.field === "order",
  );
});

test("unavailable token endpoint is UNAUTHENTICATED and cannot leak its body", async () => {
  const client = createApiClient({
    baseUrl: "https://api.example.test",
    fetch: async () =>
      Response.json({ error: { message: "secret upstream detail" } }, { status: 500 }),
  });
  await assert.rejects(
    client.get("/orders"),
    (error) =>
      error instanceof ApiError &&
      error.code === "UNAUTHENTICATED" &&
      !error.message.includes("secret"),
  );
});

test("JSON mutations, idempotency keys, response schema, and 204 are supported", async () => {
  const key = idempotencyKey();
  assert.match(key, /^[0-9a-f-]{36}$/);
  const calls = [];
  const client = createApiClient({
    baseUrl: "https://api.example.test",
    fetch: async (_url, init) => {
      calls.push(init);
      return init.method === "DELETE"
        ? new Response(null, { status: 204 })
        : Response.json({ id: 1 });
    },
  });
  assert.deepEqual(
    await client.post(
      "/orders",
      { item: 1 },
      { auth: false, idempotencyKey: key, schema: z.object({ id: z.number() }) },
    ),
    { id: 1 },
  );
  assert.equal(calls[0].headers.get("Idempotency-Key"), key);
  assert.equal(calls[0].credentials, "omit");
  assert.equal(calls[0].headers.get("Content-Type"), "application/json");
  assert.equal(calls[0].body, '{"item":1}');
  assert.equal(await client.delete("/orders/1", { auth: false }), undefined);
  await client.get("/api/auth/get-session", { auth: false, credentials: "include" });
  assert.equal(calls[2].credentials, "include");
});

test("timeout and invalid paths fail without exposing upstream text", async () => {
  assert.throws(() => createApiClient({ baseUrl: "https://api.example.test/private" }), TypeError);
  // AbortSignal.timeout uses an unref'd timer in Node; keep the test alive.
  const keepAlive = setTimeout(() => {}, 100);
  const client = createApiClient({
    baseUrl: "https://api.example.test",
    fetch: async (_url, init) => {
      await new Promise((_, reject) =>
        init.signal.addEventListener("abort", () => reject(init.signal.reason)),
      );
    },
  });
  try {
    await assert.rejects(
      client.get("/slow", { auth: false, timeoutMs: 5 }),
      (error) => error instanceof ApiError && error.code === "TIMEOUT",
    );
    await assert.rejects(client.get("//evil.example", { auth: false }), TypeError);
  } finally {
    clearTimeout(keepAlive);
  }
});
