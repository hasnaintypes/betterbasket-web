import { Body, Controller, Get, Post, Query, Req } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Auth } from "@betterbasket/auth-shared";
import { CreateSellerInputSchema, type CreateSellerInput } from "@betterbasket/contracts";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { SellersService } from "./sellers.service";

interface AuthedRequest {
  user: { sub: string; activeOrganizationId?: string | null };
}

@ApiTags("sellers")
@Controller("sellers")
export class SellersController {
  constructor(private readonly sellersService: SellersService) {}

  @Post("onboard")
  @Auth("customer", "seller")
  @ApiBearerAuth()
  onboard(
    @Req() req: AuthedRequest,
    @Body(new ZodValidationPipe(CreateSellerInputSchema)) body: CreateSellerInput,
  ) {
    if (!req.user.activeOrganizationId) {
      throw new Error(
        "No active organization — create one via authClient.organization.create() first",
      );
    }
    return this.sellersService.onboard(req.user.activeOrganizationId, body);
  }

  @Get("me")
  @Auth("seller")
  @ApiBearerAuth()
  me(@Req() req: AuthedRequest) {
    return this.sellersService.findByOrganization(req.user.activeOrganizationId ?? "");
  }

  @Post("me/onboarding-link")
  @Auth("seller")
  @ApiBearerAuth()
  onboardingLink(
    @Req() req: AuthedRequest,
    @Query("returnUrl") returnUrl: string,
    @Query("refreshUrl") refreshUrl: string,
  ) {
    return this.sellersService.createOnboardingLink(
      req.user.activeOrganizationId ?? "",
      returnUrl,
      refreshUrl,
    );
  }
}
