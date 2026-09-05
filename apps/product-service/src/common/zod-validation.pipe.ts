import { BadRequestException, type PipeTransform } from "@nestjs/common";
import type { ZodType } from "zod";

/**
 * Validates request bodies against a Zod schema from @betterbasket/contracts
 * instead of class-validator DTOs — keeps one source of truth for shapes
 * shared with Kafka events and frontend forms.
 *
 * Usage: @Body(new ZodValidationPipe(CreateProductInputSchema)) body: CreateProductInput
 */
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodType) {}

  transform(value: unknown) {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException(result.error.flatten());
    }
    return result.data;
  }
}
