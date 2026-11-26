import { Controller, Get } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Public } from "@betterbasket/auth-shared";
import { categories } from "./catalog";

@ApiTags("categories")
@Controller("categories")
export class CategoriesController {
  @Get()
  @Public()
  list() {
    return categories;
  }
}
