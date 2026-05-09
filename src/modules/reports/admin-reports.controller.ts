import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
} from '@nestjs/common';

import { AdminOnly } from '../admin/admin-auth/decorators/admin-only.decorator';
import { CurrentAdmin } from '../admin/admin-auth/decorators/current-admin.decorator';
import { RequirePermissions } from '../admin/admin-auth/decorators/require-permissions.decorator';
import { AuthenticatedAdmin } from '../admin/admin-auth/strategies/admin-jwt.strategy';
import { PERMISSIONS } from '../admin/permissions.catalog';
import { UpdateReportDto } from './dto/update-report.dto';
import { ReportsService } from './reports.service';
import {
  ReportReason,
  ReportStatus,
  ReportTargetType,
} from './schemas/user-report.schema';

/**
 * Admin moderation queue for user reports. Reuses the existing
 * `MODERATION_VIEW` / `MODERATION_ACTION` permissions — moderators
 * already have these by default ([permissions.catalog.ts:73-75]).
 */
@Controller({ path: 'admin/reports', version: '1' })
@AdminOnly()
export class AdminReportsController {
  constructor(private readonly reports: ReportsService) {}

  @RequirePermissions(PERMISSIONS.MODERATION_VIEW)
  @Get()
  async list(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('status') status?: ReportStatus,
    @Query('reason') reason?: ReportReason,
    @Query('targetType') targetType?: ReportTargetType,
    @Query('targetUserId') targetUserId?: string,
  ) {
    return this.reports.list({
      page,
      limit,
      status,
      reason,
      targetType,
      targetUserId,
    });
  }

  /** Sidebar badge count for the moderation tab — pending reports
   *  awaiting first-touch review. Cheap; safe to poll every 60s. */
  @RequirePermissions(PERMISSIONS.MODERATION_VIEW)
  @Get('pending-count')
  async pendingCount() {
    return { count: await this.reports.pendingCount() };
  }

  @RequirePermissions(PERMISSIONS.MODERATION_VIEW)
  @Get(':id')
  async getOne(@Param('id') id: string) {
    const report = await this.reports.getById(id);
    return { report };
  }

  @RequirePermissions(PERMISSIONS.MODERATION_ACTION)
  @Patch(':id')
  async update(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Param('id') id: string,
    @Body() dto: UpdateReportDto,
  ) {
    const report = await this.reports.update(id, admin.adminId, dto);
    return { report };
  }
}
