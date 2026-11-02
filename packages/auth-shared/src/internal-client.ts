import { InternalTokenSigner } from "./internal-token.js";

const IDEMPOTENT = new Set(["GET", "HEAD", "OPTIONS", "PUT", "DELETE"]);

export class InternalHttpClient {
  constructor(
    private readonly signer: InternalTokenSigner,
    private readonly audience: string,
    private readonly baseUrl: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    new URL(baseUrl);
  }

  async request(path: string, init: RequestInit = {}, requestId?: string): Promise<Response> {
    if (!path.startsWith("/internal/") || path.startsWith("//"))
      throw new Error("Internal client path must start with /internal/");
    const method = (init.method ?? "GET").toUpperCase();
    const url = new URL(path, this.baseUrl);
    if (url.origin !== new URL(this.baseUrl).origin || !url.pathname.startsWith("/internal/"))
      throw new Error("Invalid internal URL");
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${this.signer.sign(this.audience)}`);
    if (requestId) headers.set("X-Request-Id", requestId);
    const maxAttempts = IDEMPOTENT.has(method) ? 2 : 1;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const response = await this.fetcher(url, {
          ...init,
          method,
          headers,
          signal: AbortSignal.any([
            AbortSignal.timeout(2000),
            ...(init.signal ? [init.signal] : []),
          ]),
        });
        if (response.status < 500 || attempt + 1 === maxAttempts) return response;
        await response.body?.cancel();
      } catch (error) {
        if (attempt + 1 === maxAttempts || !(error instanceof TypeError)) throw error;
      }
      headers.set("Authorization", `Bearer ${this.signer.sign(this.audience)}`);
    }
    throw new Error("Internal request failed");
  }
}
