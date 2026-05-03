import { Controller, Get, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';

import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SvipService } from './svip.service';

@Controller({ path: 'svip', version: '1' })
export class SvipController {
  constructor(private readonly svip: SvipService) {}

  /**
   * Public list of all active tiers — shown on the SVIP landing screen
   * even to non-logged-in users so they can see what each tier offers.
   */
  @Public()
  @Get('tiers')
  async listTiers() {
    const items = await this.svip.listTiers(true);
    return { items };
  }

  /** Privilege catalog so the mobile app can render the labels. */
  @Public()
  @Get('privileges')
  async listPrivileges() {
    return { items: this.svip.listPrivileges() };
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async myStatus(@CurrentUser() current: AuthenticatedUser) {
    const status = await this.svip.getOrCreateStatus(current.userId);
    const privileges = await this.svip.resolvedPrivileges(current.userId);
    return { status, privileges };
  }

  /**
   * Buy an SVIP tier with coins. Errors:
   *   • 400 INVALID_USER_ID — caller id malformed (shouldn't happen with auth).
   *   • 400 TIER_NOT_PURCHASABLE — admins haven't set `coinPrice` for this tier.
   *   • 404 SVIP_TIER_NOT_FOUND — bad level number.
   *   • 409 ALREADY_OWNED — caller already at this tier or higher.
   *   • 400 INSUFFICIENT_BALANCE — wallet debit failed (the mobile UI
   *     pre-checks balance and shows Recharge instead, so this is a
   *     race-condition guardrail rather than the common path).
   */
  @UseGuards(JwtAuthGuard)
  @Post('tiers/:level/purchase')
  async purchaseTier(
    @CurrentUser() current: AuthenticatedUser,
    @Param('level', ParseIntPipe) level: number,
  ) {
    const status = await this.svip.purchaseTier(current.userId, level);
    return { status };
  }
}
