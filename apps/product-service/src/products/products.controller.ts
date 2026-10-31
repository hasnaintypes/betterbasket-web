import { Body, Controller, Get, Param, Post, Query, Req } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Auth } from "@betterbasket/auth-shared";
import {
  CreateProductInputSchema,
  PaginationQuerySchema,
  type CreateProductInput,
  type PaginationQuery,
} from "@betterbasket/contracts";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { ProductsService } from "./products.service";

@ApiTags("products")
@Controller("products")
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  list(@Query(new ZodValidationPipe(PaginationQuerySchema)) query: PaginationQuery) {
    return this.productsService.findPublished(query);
  }

  @Get(":slug")
  getBySlug(@Param("slug") slug: string) {
    return this.productsService.findBySlug(slug);
  }

  @Post()
  @Auth("seller")
  @ApiBearerAuth()
  create(
    @Req() req: { user: { sub: string; activeOrganizationId?: string | null } },
    @Body(new ZodValidationPipe(CreateProductInputSchema)) body: CreateProductInput,
  ) {
    // `sub` is the seller's user id; `activeOrganizationId` ties the product to their store.
    // seller-service resolves organizationId -> Seller.id.
    return this.productsService.create(req.user.sub, req.user.activeOrganizationId ?? "", body);
  }
}
