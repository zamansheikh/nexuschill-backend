import {
  Body,
  Controller,
  ForbiddenException,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { Public } from '../../common/decorators/public.decorator';
import { RevenueCatWebhookDto } from './dto/revenuecat-webhook.dto';
import { RevenueCatService } from './revenuecat.service';

/**
 * RevenueCat → Zimo Live webhook receiver.
 *
 * Routing:
 *   POST /api/v1/webhooks/revenuecat
 *
 * Auth:
 *   `Authorization` header — must match `REVENUECAT_WEBHOOK_AUTH` byte
 *   for byte. RevenueCat lets you set any string here in their
 *   dashboard; we use it as a shared secret. Mismatch returns 403.
 *
 * Idempotency:
 *   Pushed down into `RevenueCatService` + `WalletService` via the
 *   transaction's `idempotencyKey`. Re-deliveries are silent no-ops.
 *
 * Throttling:
 *   1000 events/minute is well above any legitimate traffic and far
 *   below what RC retry-storms could send. Tune via env if needed.
 */
@Controller({ path: 'webhooks/revenuecat', version: '1' })
export class RevenueCatController {
  private readonly logger = new Logger(RevenueCatController.name);

  constructor(private readonly rc: RevenueCatService) {}

  @Public()
  @Throttle({ default: { limit: 1000, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post()
  async receive(
    @Headers('authorization') auth: string | undefined,
    @Body() body: RevenueCatWebhookDto,
  ): Promise<{ ok: boolean; status: string; detail?: string }> {
    if (!this.rc.isAuthorized(auth)) {
      // Throw 403 (not 401) so we don't leak realm info via a
      // WWW-Authenticate challenge.
      throw new ForbiddenException({
        code: 'REVENUECAT_AUTH_FAILED',
        message: 'Webhook authorization rejected',
      });
    }
    if (!body?.event?.id || !body.event.type) {
      // Don't 400 — RC retries 4xx but not 200. We accept the request,
      // log it, and respond OK so RC stops retrying a malformed event.
      this.logger.warn('RC webhook missing event.id / event.type — dropping');
      return { ok: true, status: 'malformed' };
    }
    const result = await this.rc.handleEvent(body.event);
    return { ok: true, status: result.status, detail: result.detail };
  }
}
