import { Body, Controller, Get, Patch } from '@nestjs/common';
import { IsBoolean, IsIn, IsInt, IsOptional, Min } from 'class-validator';

import { Public } from '../../common/decorators/public.decorator';
import { AdminOnly } from '../admin/admin-auth/decorators/admin-only.decorator';
import { RequirePermissions } from '../admin/admin-auth/decorators/require-permissions.decorator';
import { PERMISSIONS } from '../admin/permissions.catalog';
import { SystemConfigService } from './system-config.service';

class UpdateAppConfigDto {
  @IsOptional()
  @IsBoolean()
  familiesEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  agenciesEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  emailLoginEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  phoneLoginEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  liveRequiresAgency?: boolean;

  @IsOptional()
  @IsBoolean()
  audioHostEndsLive?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  liveValidDayMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  liveValidMonthDays?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  liveValidDayReward?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  liveValidMonthBonus?: number;

  @IsOptional()
  @IsIn(['coins', 'diamonds'])
  liveValidRewardCurrency?: 'coins' | 'diamonds';
}

/**
 * Public read so mobile clients can hide / show feature entry points
 * (e.g., the "Create Family" button) without authenticating. Admin write
 * is gated by `system.config` permission — by default only super_admin
 * and admin roles have it.
 */
@Controller({ path: '', version: '1' })
export class SystemConfigController {
  constructor(private readonly svc: SystemConfigService) {}

  @Public()
  @Get('system-config')
  async getPublic() {
    const cfg = await this.svc.getConfig();
    return {
      familiesEnabled: cfg.familiesEnabled,
      agenciesEnabled: cfg.agenciesEnabled,
      emailLoginEnabled: cfg.emailLoginEnabled,
      phoneLoginEnabled: cfg.phoneLoginEnabled,
      liveRequiresAgency: cfg.liveRequiresAgency,
      audioHostEndsLive: cfg.audioHostEndsLive,
      liveValidDayMinutes: cfg.liveValidDayMinutes,
      liveValidMonthDays: cfg.liveValidMonthDays,
      liveValidDayReward: cfg.liveValidDayReward,
      liveValidMonthBonus: cfg.liveValidMonthBonus,
      liveValidRewardCurrency: cfg.liveValidRewardCurrency,
    };
  }

  @Get('admin/system-config')
  @AdminOnly()
  @RequirePermissions(PERMISSIONS.SYSTEM_CONFIG)
  async getAdmin() {
    const cfg = await this.svc.getConfig();
    return { config: cfg };
  }

  @Patch('admin/system-config')
  @AdminOnly()
  @RequirePermissions(PERMISSIONS.SYSTEM_CONFIG)
  async update(@Body() dto: UpdateAppConfigDto) {
    const config = await this.svc.updateConfig(dto);
    return { config };
  }
}
