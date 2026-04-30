import { Controller, Get, UseGuards } from '@nestjs/common';

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
}
