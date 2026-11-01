import { Inject, Injectable } from "@nestjs/common";
import { GATEWAY_CONFIG, type GatewayConfig } from "../config";

@Injectable()
export class ServiceRegistry {
  constructor(@Inject(GATEWAY_CONFIG) private readonly config: GatewayConfig) {}

  get auth() {
    return this.config.AUTH_SERVICE_URL;
  }
  get product() {
    return this.config.PRODUCT_SERVICE_URL;
  }
  get seller() {
    return this.config.SELLER_SERVICE_URL;
  }
  get order() {
    return this.config.ORDER_SERVICE_URL;
  }
  get payment() {
    return this.config.PAYMENT_SERVICE_URL;
  }
  get notification() {
    return this.config.NOTIFICATION_SERVICE_URL;
  }
  get media() {
    return this.config.MEDIA_SERVICE_URL;
  }
  get analytics() {
    return this.config.ANALYTICS_SERVICE_URL;
  }
}
