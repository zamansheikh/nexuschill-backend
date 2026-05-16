import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';

import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { LiveRecordService } from './live-record.service';

/**
 * Endpoints behind the mobile Live Record page.
 *
 *   • `GET /me/live-record/:year/:month` — dense per-day breakdown,
 *     valid-day count, claim eligibility, snapshot of admin
 *     thresholds + reward amounts.
 *   • `POST /me/live-record/:year/:month/claim` — claim the
 *     monthly bonus. Credits the wallet, marks the ledger.
 *     Returns the claim summary; the mobile client follows with
 *     `GET .../pdf` to fetch the certificate.
 *   • `GET /me/live-record/:year/:month/pdf` — streams the PDF.
 *     Requires the host to have claimed first.
 *
 * All routes are scoped to the calling user — there's no `userId`
 * path param. Admin moderation of someone else's live record can
 * land later via `/admin/live-record/:userId/...`.
 */
@Controller({ path: 'me/live-record', version: '1' })
@UseGuards(JwtAuthGuard)
export class LiveRecordController {
  constructor(private readonly svc: LiveRecordService) {}

  @Get(':year/:month')
  async monthly(
    @CurrentUser() current: AuthenticatedUser,
    @Param('year', ParseIntPipe) year: number,
    @Param('month', ParseIntPipe) month: number,
  ) {
    return this.svc.getMonthly(current.userId, year, month);
  }

  @Post(':year/:month/claim')
  async claim(
    @CurrentUser() current: AuthenticatedUser,
    @Param('year', ParseIntPipe) year: number,
    @Param('month', ParseIntPipe) month: number,
  ) {
    const record = await this.svc.claimMonthly(current.userId, year, month);
    return { record };
  }

  @Get(':year/:month/pdf')
  async pdf(
    @CurrentUser() current: AuthenticatedUser,
    @Param('year', ParseIntPipe) year: number,
    @Param('month', ParseIntPipe) month: number,
    @Res() res: Response,
  ): Promise<void> {
    const pdf = await this.svc.generatePdf(current.userId, year, month);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="live-record-${year}-${String(month).padStart(2, '0')}.pdf"`,
    );
    res.send(pdf);
  }
}
