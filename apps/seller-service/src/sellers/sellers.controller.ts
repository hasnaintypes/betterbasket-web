import { Body, Controller, Get, Post, Query, Req } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Capability, HighRisk, type AuthenticatedRequest } from "@betterbasket/auth-shared";
import { CreateSellerInputSchema, type CreateSellerInput } from "@betterbasket/contracts";
import { ZodValidationPipe } from "@betterbasket/runtime";
import { SellersService } from "./sellers.service";

@ApiTags("sellers")
@Controller("sellers")
export class SellersController {
  constructor(private readonly sellersService: SellersService) {}

  @Post("onboard")
  @Capability("seller:write")
  @ApiBearerAuth()
  onboard(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(CreateSellerInputSchema)) body: CreateSellerInput,
  ) {
    if (!req.user.orgId) {
      throw new Error(
        "No active organization — create one via authClient.organization.create() first",
      );
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
