import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Request } from 'express';
import { Observable, map } from 'rxjs';

interface SuccessEnvelope<T> {
  success: true;
  data: T;
  error: null;
  meta: {
    traceId?: string;
    timestamp: string;
  };
}

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, SuccessEnvelope<T>> {
  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<SuccessEnvelope<T>> {
    const req = context.switchToHttp().getRequest<Request & { traceId?: string }>();

    return next.handle().pipe(
      map((data) => ({
        success: true as const,
        data,
        error: null,
        meta: {
          traceId: req.traceId,
          timestamp: new Date().toISOString(),
        },
      })),
    );
  }
}
