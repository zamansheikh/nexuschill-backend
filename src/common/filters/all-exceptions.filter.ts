import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

interface ErrorEnvelope {
  success: false;
  data: null;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  meta: {
    traceId?: string;
    path: string;
    timestamp: string;
  };
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let message = 'An unexpected error occurred';
    let details: unknown;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const resp = exception.getResponse();
      if (typeof resp === 'string') {
        message = resp;
      } else if (typeof resp === 'object' && resp !== null) {
        const r = resp as Record<string, unknown>;
        message = (r.message as string) || message;
        code = (r.code as string) || this.statusToCode(status);
        details = r.details;
      }
    } else if (exception instanceof Error) {
      message = exception.message;
      this.logger.error(exception.stack);
    } else {
      this.logger.error(`Non-Error exception thrown: ${JSON.stringify(exception)}`);
    }

    if (!code || code === 'INTERNAL_ERROR') {
      code = this.statusToCode(status);
    }

    const body: ErrorEnvelope = {
      success: false,
      data: null,
      error: { code, message, ...(details !== undefined && { details }) },
      meta: {
        traceId: (request as Request & { traceId?: string }).traceId,
        path: request.url,
        timestamp: new Date().toISOString(),
      },
    };

    response.status(status).json(body);
  }

  private statusToCode(status: number): string {
    const map: Record<number, string> = {
      400: 'BAD_REQUEST',
      401: 'UNAUTHORIZED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
      422: 'VALIDATION_ERROR',
      429: 'TOO_MANY_REQUESTS',
      500: 'INTERNAL_ERROR',
      502: 'BAD_GATEWAY',
      503: 'SERVICE_UNAVAILABLE',
    };
    return map[status] || 'ERROR';
  }
}
