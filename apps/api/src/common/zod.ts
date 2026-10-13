import { applyDecorators, BadRequestException, Body, PipeTransform, Query } from '@nestjs/common';
import { ApiBody } from '@nestjs/swagger';
import type { ZodTypeAny, z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

export class ZodPipe<T extends ZodTypeAny> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const res = this.schema.safeParse(value);
    if (!res.success) {
      throw new BadRequestException({
        message: 'Validasi gagal',
        errors: res.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    return res.data;
  }
}

/** @Body tervalidasi Zod + dokumentasi Swagger dari skema yang sama. */
export function ZBody<T extends ZodTypeAny>(schema: T): ParameterDecorator {
  return Body(new ZodPipe(schema));
}

export function ApiZodBody(schema: ZodTypeAny) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return applyDecorators(ApiBody({ schema: zodToJsonSchema(schema, { target: 'openApi3' }) as any }));
}

export function ZQuery<T extends ZodTypeAny>(schema: T): ParameterDecorator {
  return Query(new ZodPipe(schema));
}
