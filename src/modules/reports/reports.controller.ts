import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';

import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { CreateReportDto } from './dto/create-report.dto';
import { ReportsService } from './reports.service';

/**
 * User-facing report submission. Mounted at the root user-side
 * versioned API so the mobile client can hit a single, well-known
 * endpoint regardless of the target type (user / room / moment /
 * message). Admin endpoints live in the admin module.
 */
@Controller({ path: 'reports', version: '1' })
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @HttpCode(HttpStatus.CREATED)
  @Post()
  async create(
    @CurrentUser() current: AuthenticatedUser,
    @Body() dto: CreateReportDto,
  ) {
    const report = await this.reports.create(current.userId, dto);
    // Return id only — the client doesn't need to render report state
    // and admins are the only audience for the rest of the document.
    return { reportId: report._id.toString() };
  }
}
