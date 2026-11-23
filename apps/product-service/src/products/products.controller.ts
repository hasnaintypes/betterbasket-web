import { Body, Controller, Get, Param, Post, Query, Req } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Capability, Public, type AuthenticatedRequest } from "@betterbasket/auth-shared";
import { ZodValidationPipe } from "@betterbasket/runtime";
import {
  CreateProductInputSchema,
  PaginationQuerySchema,
  type CreateProductInput,
  type PaginationQuery,
} from "@betterbasket/contracts";
import { ProductsService } from "./products.service";

@ApiTags("products")
@Controller("products")
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  @Public()
  list(@Query(new ZodValidationPipe(PaginationQuerySchema)) query: PaginationQuery) {
    return this.productsService.findPublished(query);
  }

  @Get(":slug")
  @Public()
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
    return this.productsService.create(req.tenant!.sellerId, req.user.orgId ?? "", body);
  }
}
