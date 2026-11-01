import { BadRequestException, type PipeTransform } from "@nestjs/common";
import { z } from "zod";

export interface ValidationDetail {
  field: string;
  issue: string;
}

function fieldPath(path: PropertyKey[]): string {
  return `/${path.map((part) => String(part).replace(/~/g, "~0").replace(/\//g, "~1")).join("/")}`;
}

export function zodDetails(error: z.ZodError): ValidationDetail[] {
  return error.issues.map((issue) => ({
    field: fieldPath(issue.path),
    issue: issue.code === "invalid_type" ? "Invalid type" : "Invalid value",
  }));
}

export class ZodValidationPipe<T extends z.ZodType> implements PipeTransform<unknown, z.output<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.output<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        code: "VALIDATION_FAILED",
        message: "Validation failed",
        details: zodDetails(result.error),
      });
    }
    return result.data;
  }
}
