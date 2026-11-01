import { createHash } from "node:crypto";
import { createServer, type IncomingHttpHeaders, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { once } from "node:events";

export interface RecordedRequest {
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
  body: Buffer;
  bodySha256: string;
}

export interface StubResponse {
  status?: number;
  headers?: Record<string, string>;
  body?: string | Buffer;
}

export type UpgradeHandler = (request: RecordedRequest, socket: Duplex, head: Buffer) => void;

export async function createStubUpstream() {
  const requests: RecordedRequest[] = [];
  const responses: StubResponse[] = [];
  let upgradeHandler: UpgradeHandler | undefined;
  const server = createServer(async (request, response: ServerResponse) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk as Buffer));
    const body = Buffer.concat(chunks);
    requests.push({
      method: request.method ?? "GET",
      url: request.url ?? "/",
      headers: request.headers,
      body,
      bodySha256: createHash("sha256").update(body).digest("hex"),
    });
    const scripted = responses.shift() ?? { status: 200 };
    response.writeHead(scripted.status ?? 200, scripted.headers);
    response.end(scripted.body);
  });
  server.on("upgrade", (request, socket, head) => {
    const recorded: RecordedRequest = {
      method: request.method ?? "GET",
      url: request.url ?? "/",
      headers: request.headers,
      body: Buffer.alloc(0),
      bodySha256: createHash("sha256").update("").digest("hex"),
    };
    requests.push(recorded);
    if (upgradeHandler) upgradeHandler(recorded, socket, head);
    else socket.destroy();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Stub server has no TCP address");
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    enqueue(response: StubResponse) {
      responses.push(response);
    },
    onUpgrade(handler: UpgradeHandler) {
      upgradeHandler = handler;
    },
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
