import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
} from '@nestjs/common';

import { Public } from '../../common/decorators/public.decorator';
import { AdminOnly } from '../admin/admin-auth/decorators/admin-only.decorator';
import { RequirePermissions } from '../admin/admin-auth/decorators/require-permissions.decorator';
import { PERMISSIONS } from '../admin/permissions.catalog';
import { UpdateRocketConfigDto } from './dto/rocket.dto';
import { RocketService } from './rocket.service';

@Controller({ path: 'rocket', version: '1' })
export class RocketController {
  constructor(private readonly svc: RocketService) {}

  /** Public — mobile reads the level ladder + countdown setting from
   *  here. Cached client-side; refetched on rocket page open. */
  @Public()
  @Get('config')
  async getConfig() {
    const config = await this.svc.getConfig();
    return {
      enabled: config.enabled,
      timezone: config.timezone,
      topContributionThreshold: config.topContributionThreshold,
      launchCountdownSeconds: config.launchCountdownSeconds,
      cascadeDelaySeconds: config.cascadeDelaySeconds,
      levels: config.levels,
    };
  }

  /** Today's rocket state for one room. Auth-required so the realtime
   *  scope check works. The state row is lazy-created at level 1 if
   *  no gifts have landed yet today. Includes a server-computed
   *  `nextResetAt` so the countdown clock on the page renders correctly
   *  regardless of client clock skew. */
  @Get('state/:roomId')
  async getState(@Param('roomId') roomId: string) {
    const [state, nextResetAt] = await Promise.all([
      this.svc.getStateOrThrow(roomId),
      this.svc.nextResetAt(),
    ]);
    return { state, nextResetAt: nextResetAt.toISOString() };
  }

  // -------- Admin --------

  @AdminOnly()
  @RequirePermissions(PERMISSIONS.ROCKET_VIEW)
  @Get('admin/config')
  async getAdminConfig() {
    const config = await this.svc.getConfig();
    return { config };
  }

  @AdminOnly()
  @RequirePermissions(PERMISSIONS.ROCKET_MANAGE)
  @Patch('admin/config')
  async updateAdminConfig(@Body() dto: UpdateRocketConfigDto) {
    const config = await this.svc.updateConfig(dto);
    return { config };
  }
}
