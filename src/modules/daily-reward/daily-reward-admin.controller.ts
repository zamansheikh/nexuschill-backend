import { Body, Controller, Get, Patch } from '@nestjs/common';

import { AdminOnly } from '../admin/admin-auth/decorators/admin-only.decorator';
import { RequirePermissions } from '../admin/admin-auth/decorators/require-permissions.decorator';
import { PERMISSIONS } from '../admin/permissions.catalog';
import { DailyRewardService } from './daily-reward.service';
import { UpsertDailyRewardConfigDto } from './dto/daily-reward.dto';

@Controller({ path: 'admin/daily-reward', version: '1' })
@AdminOnly()
export class DailyRewardAdminController {
  constructor(private readonly daily: DailyRewardService) {}

  @RequirePermissions(PERMISSIONS.DAILY_REWARD_VIEW)
  @Get('config')
  async get() {
    const config = await this.daily.getOrCreateConfig();
    return { config };
  }

  @RequirePermissions(PERMISSIONS.DAILY_REWARD_MANAGE)
  @Patch('config')
  async update(@Body() dto: UpsertDailyRewardConfigDto) {
    const config = await this.daily.upsertConfig(dto);
    return { config };
  }
}
