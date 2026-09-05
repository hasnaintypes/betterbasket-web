import { Body, Controller, Get, Param, Post, Req } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Auth } from "@betterbasket/auth-shared";
import { CreateOrderInputSchema, type CreateOrderInput } from "@betterbasket/contracts";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { OrdersService } from "./orders.service";

interface AuthedRequest {
  user: { sub: string };
}

@ApiTags("orders")
@Controller("orders")
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @Auth("customer")
  @ApiBearerAuth()
  create(
    @Req() req: AuthedRequest,
    @Body(new ZodValidationPipe(CreateOrderInputSchema)) body: CreateOrderInput,
  ) {
    return this.ordersService.create(req.user.sub, body);
  }

  @Get()
  @Auth("customer")
  @ApiBearerAuth()
  mine(@Req() req: AuthedRequest) {
    return this.ordersService.findMine(req.user.sub);
  }

  @Get(":id")
  @Auth("customer")
  @ApiBearerAuth()
  getById(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.ordersService.findById(id, req.user.sub);
  }
}
