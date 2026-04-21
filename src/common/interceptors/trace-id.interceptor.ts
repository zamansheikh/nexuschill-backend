import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Request, Response } from 'express';
import { nanoid } from 'nanoid';
import { Observable } from 'rxjs';

@Injectable()
export class TraceIdInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const ctx = context.switchToHttp();
    const req = ctx.getRequest<Request & { traceId?: string }>();
    const res = ctx.getResponse<Response>();

    const incomingTraceId = req.headers['x-trace-id'];
    const traceId = typeof incomingTraceId === 'string' ? incomingTraceId : nanoid(16);

    req.traceId = traceId;
    res.setHeader('x-trace-id', traceId);

    return next.handle();
  }
}
