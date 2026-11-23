import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { Capability, HighRisk, type AuthenticatedRequest } from "@betterbasket/auth-shared";
import { CreateSellerInputSchema, type CreateSellerInput } from "@betterbasket/contracts";
import { ZodValidationPipe } from "@betterbasket/runtime";
import { SellersService } from "./sellers.service";

@ApiTags("sellers")
@Controller("sellers")
export class SellersController {
  constructor(private readonly sellersService: SellersService) {}

  @Post("onboard")
  @HttpCode(200)
  @Capability("seller:register")
  @ApiBearerAuth()
  @ApiBody({
    schema: {
      type: "object",
      required: ["storeName", "slug", "country", "supportEmail"],
      additionalProperties: false,
      properties: {
        storeName: { type: "string" },
        slug: { type: "string" },
        description: { type: "string" },
        country: { type: "string", minLength: 2, maxLength: 2 },
        supportEmail: { type: "string", format: "email" },
      },
    },
  })
  @ApiOkResponse({
    schema: {
      type: "object",
      required: ["id", "status", "slug"],
      properties: {
        id: { type: "string", format: "uuid" },
        status: {
          type: "string",
          enum: ["pending", "stripe_pending", "under_review", "active", "suspended", "closed"],
        },
        slug: { type: "string" },
      },
    },
  })
  onboard(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(CreateSellerInputSchema)) body: CreateSellerInput,
  ) {
    if (!req.user.orgId) {
      throw new BadRequestException({
        code: "VALIDATION_FAILED",
        message: "Create and activate an organization before registering a seller",
      });
    }
    return this.sellersService.onboard(req.user.orgId, body);
  }

  @Get("me")
  @Capability("seller:read")
  @ApiBearerAuth()
  me(@Req() req: AuthenticatedRequest) {
    return this.sellersService.findByOrganization(req.user.orgId ?? "");
  }

  @Post("me/onboarding-link")
  @Capability("stripe:manage")
  @HighRisk()
  @ApiBearerAuth()
  onboardingLink(
    @Req() req: AuthenticatedRequest,
    @Query("returnUrl") returnUrl: string,
    @Query("refreshUrl") refreshUrl: string,
  ) {
    return this.sellersService.createOnboardingLink(req.user.orgId ?? "", returnUrl, refreshUrl);
  }
}
