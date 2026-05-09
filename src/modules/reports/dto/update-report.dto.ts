import { IsEnum, IsOptional, IsString, Length } from 'class-validator';

import { ReportStatus } from '../schemas/user-report.schema';

/** Body of `PATCH /admin/reports/:id`. Admins can only move forward
 *  through the lifecycle — a report can't be re-opened by editing the
 *  status here (delete + re-create instead, if ever needed). */
export class UpdateReportDto {
  @IsEnum(ReportStatus)
  status!: ReportStatus;

  @IsOptional()
  @IsString()
  @Length(0, 1000)
  adminNote?: string;
}
