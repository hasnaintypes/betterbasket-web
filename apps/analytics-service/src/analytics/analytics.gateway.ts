import { WebSocketGateway, WebSocketServer } from "@nestjs/websockets";
import type { Server } from "socket.io";

/**
 * Real-time channel for seller-portal / admin-portal dashboards. Rooms are
 * per-organization (`org:<organizationId>`) so a seller only receives events
 * for their own store; admins join `org:*`/`platform` for aggregate feeds.
 *
 * NOTE (Tier 4): connection auth (verifying the JWT on the socket handshake)
 * isn't wired yet — see docs/PRD.md Tier 4 for the join-room + auth handshake.
 */
@WebSocketGateway({ cors: { origin: "*" }, namespace: "/realtime" })
export class AnalyticsGateway {
  @WebSocketServer()
  server!: Server;

  emitToOrganization(organizationId: string, event: string, payload: unknown) {
    this.server.to(`org:${organizationId}`).emit(event, payload);
  }

  emitToPlatform(event: string, payload: unknown) {
    this.server.to("platform").emit(event, payload);
  }
}
