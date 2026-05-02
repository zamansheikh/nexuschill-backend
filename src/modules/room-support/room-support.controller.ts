import {
  Body,
  Controller,
  Get,
  Patch,
  Query,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

import { AuthenticatedUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { AdminOnly } from '../admin/admin-auth/decorators/admin-only.decorator';
import { RequirePermissions } from '../admin/admin-auth/decorators/require-permissions.decorator';
import { PERMISSIONS } from '../admin/permissions.catalog';
import { RoomSupportService } from './room-support.service';

class RoomSupportLevelDto {
  @IsInt()
  @Min(1)
  level!: number;

  @IsInt()
  @Min(0)
  minVisitors!: number;

  @IsInt()
  @Min(0)
  minCoins!: number;

  @IsInt()
  @Min(0)
  ownerCoins!: number;

  @IsInt()
  @Min(0)
  partnerCoins!: number;

  @IsInt()
  @Min(0)
  partnerSlots!: number;

  // totalCoins is recomputed server-side; clients can omit.
  @IsOptional()
  @IsInt()
  @Min(0)
  totalCoins?: number;
}

class UpdateRoomSupportConfigDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RoomSupportLevelDto)
  levels?: RoomSupportLevelDto[];

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

/**
 * Mobile-facing endpoints. The admin PATCH for editing the level ladder
 * is appended to the same controller so the routes group nicely under
 * one base path — Nest evaluates the per-handler guards independently,
 * so the public + auth + admin mix is fine here.
 */
@Controller({ path: 'room-support', version: '1' })
export class RoomSupportController {
  constructor(private readonly svc: RoomSupportService) {}

  /**
   * The level ladder + countdown context. Public so unauthenticated /
   * onboarding flows can render the "Target & Reward" table.
   */
  @Public()
  @Get('config')
  async getConfig() {
    const config = await this.svc.getConfig();
    return {
      enabled: config.enabled,
      timezone: config.timezone,
      levels: config.levels,
    };
  }

  /** Caller's owned-room stats this week + last week + next reward time. */
  @Get('me')
  async me(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.getMySummary(user.userId);
  }

  /** Top rooms this week, ranked by coins received. */
  @Public()
  @Get('ranking')
  async ranking(@Query('limit') limit?: number) {
    const items = await this.svc.getRanking(limit ? Number(limit) : 50);
    return { items };
  }

  // ---- Admin: edit the ladder + toggle the feature ----

  @AdminOnly()
  @RequirePermissions(PERMISSIONS.SYSTEM_CONFIG)
  @Patch('config')
  async updateConfig(@Body() dto: UpdateRoomSupportConfigDto) {
    const config = await this.svc.updateConfig(dto);
    return { config };
  }
}
