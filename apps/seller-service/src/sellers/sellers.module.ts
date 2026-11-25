import { Module } from "@nestjs/common";
import { SellersService } from "./sellers.service";
import { SellersController } from "./sellers.controller";
import { SellerStripeProvider } from "./stripe.provider";

@Module({
  controllers: [SellersController],
  providers: [SellersService, SellerStripeProvider],
})
export class SellersModule {}
