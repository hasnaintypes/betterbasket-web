import { Body, Controller, Get, Param, Post, Req } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Capability, type AuthenticatedRequest } from "@betterbasket/auth-shared";
import { CreateOrderInputSchema, type CreateOrderInput } from "@betterbasket/contracts";
import { ZodValidationPipe } from "@betterbasket/runtime";
import { OrdersService } from "./orders.service";

@ApiTags("orders")
@Controller("orders")
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @Capability("order:create")
  @ApiBearerAuth()
  create(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(CreateOrderInputSchema)) body: CreateOrderInput,
  ) {
    return this.ordersService.create(req.user.sub, body);
  }

  @Get()
  @Capability("order:read-own")
  @ApiBearerAuth()
  mine(@Req() req: AuthenticatedRequest) {
    return this.ordersService.findMine(req.user.sub);
  }

  @Get(":id")
  @Capability("order:read-own")
  @ApiBearerAuth()
  getById(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.ordersService.findById(id, req.user.sub);
  }
}
