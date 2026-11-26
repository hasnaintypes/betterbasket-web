import { Body, Controller, Get, Header, Param, Post, Query, Req } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Capability, Public, type AuthenticatedRequest } from "@betterbasket/auth-shared";
import { ZodValidationPipe } from "@betterbasket/runtime";
import { CreateProductInputSchema, type CreateProductInput } from "@betterbasket/contracts";
import { ProductsService } from "./products.service";
import { CatalogQuerySchema, type CatalogQuery } from "./catalog-query";

@ApiTags("products")
@Controller("products")
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  @Public()
  @Header("Cache-Control", "public, max-age=30")
  list(@Query(new ZodValidationPipe(CatalogQuerySchema)) query: CatalogQuery) {
    return this.productsService.findPublished(query);
  }

  @Get(":slug")
  @Public()
  @Header("Cache-Control", "public, max-age=30")
  getBySlug(@Param("slug") slug: string) {
    return this.productsService.findBySlug(slug);
  }

  @Post()
  @Capability("product:write")
  @ApiBearerAuth()
  create(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(CreateProductInputSchema)) body: CreateProductInput,
  ) {
    return this.productsService.create(req.tenant!.sellerId, body);
  }
}
