import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { MongooseModule } from "@nestjs/mongoose";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { ProductsModule } from "./products/products.module";
import { CategoriesController } from "./categories/categories.controller";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [`.env.${process.env.NODE_ENV ?? "development"}`, ".env"],
    }),
    MongooseModule.forRoot(process.env.MONGODB_URI!),
    ProductsModule,
  ],
  controllers: [AppController, CategoriesController],
  providers: [AppService],
})
export class AppModule {}
