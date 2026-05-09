import {
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';

import {
  ReportReason,
  ReportTargetType,
} from '../schemas/user-report.schema';

/** Body of `POST /reports`. */
export class CreateReportDto {
  @IsEnum(ReportTargetType)
  targetType!: ReportTargetType;

  @IsString()
  @Length(1, 64)
  targetId!: string;

  @IsEnum(ReportReason)
  reason!: ReportReason;

  /** Reporter's optional explanation. Capped to keep the admin queue
   *  scannable; longer evidence belongs in attached chat history /
   *  audit logs the admin can reach via the targetId. */
  @IsOptional()
  @IsString()
  @Length(0, 1000)
  description?: string;

  /** Optional structured context — e.g. `{ roomId: '...' }` when
   *  reporting a chat message inside a room. */
  @IsOptional()
  @IsObject()
  meta?: Record<string, unknown>;
}
