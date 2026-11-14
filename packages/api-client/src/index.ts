import type { ZodType } from "zod";

export interface ApiErrorDetail {
  field: string;
  issue: string;
}

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly requestId: string | null = null,
    public readonly details: ApiErrorDetail[] = [],
    public readonly status: number | null = null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface RequestOptions<T> {
  schema?: ZodType<T>;
  signal?: AbortSignal;
  timeoutMs?: number;
  auth?: boolean;
  idempotencyKey?: string;
  credentials?: RequestCredentials;
}

export interface ApiClientOptions {
  baseUrl: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
}

export function idempotencyKey(): string {
  return crypto.randomUUID();
}

function jwtExpiry(token: string): number | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const claims: unknown = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    if (!claims || typeof claims !== "object" || !("exp" in claims)) return null;
    const exp = claims.exp;
    return typeof exp === "number" && Number.isFinite(exp) ? exp * 1000 : null;
  } catch {
    return null;
  }
}

function requestPath(path: string): string {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) {
    throw new TypeError("API path must be a relative path beginning with /");
  }
  return path;
}

function timeoutSignal(timeoutMs: number, signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return { signal: signal ? AbortSignal.any([signal, timeout]) : timeout, timeout };
}

function fetchError(error: unknown, timeout: AbortSignal, requestId: string): ApiError {
  if (timeout.aborted) return new ApiError("TIMEOUT", "The request timed out", requestId);
  if (error instanceof DOMException && error.name === "AbortError") {
    return new ApiError("ABORTED", "The request was cancelled", requestId);
  }
  return new ApiError("UPSTREAM_UNAVAILABLE", "The service is unavailable", requestId);
}

async function errorFromResponse(response: Response, fallbackRequestId: string): Promise<ApiError> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    // An upstream may return HTML or an empty body.
  }
  const envelope = body && typeof body === "object" && "error" in body ? body.error : null;
  const error = envelope && typeof envelope === "object" ? envelope : null;
  const code =
    error && "code" in error && typeof error.code === "string" ? error.code : "HTTP_ERROR";
  const message =
    error && "message" in error && typeof error.message === "string"
      ? error.message
      : "The request failed";
  const requestId =
    error && "requestId" in error && typeof error.requestId === "string"
      ? error.requestId
      : (response.headers.get("x-request-id") ?? fallbackRequestId);
  const details =
    error && "details" in error && Array.isArray(error.details)
      ? error.details.filter(
          (item): item is ApiErrorDetail =>
            !!item &&
            typeof item === "object" &&
            typeof item.field === "string" &&
            typeof item.issue === "string",
        )
      : [];
  return new ApiError(code, message, requestId, details, response.status);
}

/** A browser-oriented gateway client. The JWT is only held in this closure. */
export function createApiClient(options: ApiClientOptions) {
  const base = new URL(options.baseUrl);
  if (
    !/^https?:$/.test(base.protocol) ||
    base.username ||
    base.password ||
    base.pathname !== "/" ||
    base.search ||
    base.hash
  ) {
    throw new TypeError("baseUrl must be an HTTP(S) origin");
  }
  const origin = base.origin;
  const fetcher = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const defaultTimeout = options.timeoutMs ?? 10_000;
  if (!Number.isFinite(defaultTimeout) || defaultTimeout <= 0) {
    throw new TypeError("timeoutMs must be positive");
  }
  let cached: { token: string; expiresAt: number } | null = null;
  let refreshing: Promise<string> | null = null;
  let tokenGeneration = 0;

  async function refreshToken(): Promise<string> {
    if (refreshing) return refreshing;
    const generation = tokenGeneration;
    const task = (async () => {
      const requestId = crypto.randomUUID();
      const { signal, timeout } = timeoutSignal(defaultTimeout);
      let response: Response;
      try {
        response = await fetcher(`${origin}/api/auth/token`, {
          credentials: "include",
          headers: { "X-Request-Id": requestId },
          signal,
        });
      } catch {
        throw new ApiError("UNAUTHENTICATED", "Please sign in", requestId);
      }
      if (!response.ok) throw new ApiError("UNAUTHENTICATED", "Please sign in", requestId);
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new ApiError("UNAUTHENTICATED", "Please sign in", requestId);
      }
      const token =
        body && typeof body === "object" && "token" in body && typeof body.token === "string"
          ? body.token
          : null;
      const expiresAt = token ? jwtExpiry(token) : null;
      if (!token || !expiresAt || expiresAt <= now()) {
        throw new ApiError("UNAUTHENTICATED", "Please sign in", requestId);
      }
      if (timeout.aborted || generation !== tokenGeneration) {
        throw new ApiError("UNAUTHENTICATED", "Please sign in", requestId);
      }
      cached = { token, expiresAt };
      return token;
    })();
    const tracked = task.finally(() => {
      if (refreshing === tracked) refreshing = null;
    });
    refreshing = tracked;
    return tracked;
  }

  async function tokenForRequest(): Promise<string> {
    if (cached && cached.expiresAt - now() > 60_000) return cached.token;
    return refreshToken();
  }

  async function request<T>(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    body?: unknown,
    requestOptions: RequestOptions<T> = {},
  ): Promise<T> {
    const url = `${origin}${requestPath(path)}`;
    const requestId = crypto.randomUUID();
    const timeoutMs = requestOptions.timeoutMs ?? defaultTimeout;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
      throw new TypeError("timeoutMs must be positive");
    const { signal, timeout } = timeoutSignal(timeoutMs, requestOptions.signal);
    const needsAuth = requestOptions.auth !== false;
    let token = needsAuth ? await tokenForRequest() : null;
    const send = async (bearer: string | null): Promise<Response> => {
      const headers = new Headers({ "X-Request-Id": requestId });
      if (body !== undefined) headers.set("Content-Type", "application/json");
      if (bearer) headers.set("Authorization", `Bearer ${bearer}`);
      if (requestOptions.idempotencyKey)
        headers.set("Idempotency-Key", requestOptions.idempotencyKey);
      try {
        return await fetcher(url, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          credentials: requestOptions.credentials ?? "omit",
          signal,
        });
      } catch (error) {
        throw fetchError(error, timeout, requestId);
      }
    };
    let response = await send(token);
    if (response.status === 401 && needsAuth) {
      if (cached?.token === token) cached = null;
      token = await tokenForRequest();
      response = await send(token);
    }
    if (!response.ok) throw await errorFromResponse(response, requestId);
    if (response.status === 204) return undefined as T;
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new ApiError("INVALID_RESPONSE", "The service returned an invalid response", requestId);
    }
    return requestOptions.schema ? requestOptions.schema.parse(data) : (data as T);
  }

  return {
    clearToken: () => {
      tokenGeneration++;
      cached = null;
      refreshing = null;
    },
    get: <T>(path: string, options?: RequestOptions<T>) =>
      request<T>("GET", path, undefined, options),
    post: <T>(path: string, body?: unknown, options?: RequestOptions<T>) =>
      request<T>("POST", path, body, options),
    patch: <T>(path: string, body?: unknown, options?: RequestOptions<T>) =>
      request<T>("PATCH", path, body, options),
    delete: <T>(path: string, options?: RequestOptions<T>) =>
      request<T>("DELETE", path, undefined, options),
  };
}
