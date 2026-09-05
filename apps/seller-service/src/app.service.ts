import { Injectable } from "@nestjs/common";

@Injectable()
export class AppService {
  health() {
    return { status: "ok", service: "seller-service", timestamp: new Date().toISOString() };
  }
}
