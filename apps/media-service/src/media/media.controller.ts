import { Controller, Get } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Auth } from "@betterbasket/auth-shared";
import { MediaService } from "./media.service";

@ApiTags("media")
@Controller("media")
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @Get("upload-auth")
  @Auth("seller", "customer", "admin")
  @ApiBearerAuth()
  getUploadAuth() {
    return this.mediaService.getUploadAuthParams();
  }
}
