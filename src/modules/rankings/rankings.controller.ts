import { Controller, Get, Param, Query } from '@nestjs/common';

import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import {
  RankingCategory,
  RankingPeriod,
  RankingsService,
} from './rankings.service';

/**
 * Rankings — three platform-wide leaderboards (honor / charm / room)
 * over three windows (daily / weekly / monthly). Powers the mobile
 * Ranking page reachable from the home rail.
 *
 * Authentication is required (we embed the caller's own rank in the
 * response) — the global JWT guard handles this; there's no `@Public`
 * here.
 */
@Controller({ path: 'rankings', version: '1' })
export class RankingsController {
  constructor(private readonly rankings: RankingsService) {}

  @Get(':category')
  async list(
    @CurrentUser() current: AuthenticatedUser,
    @Param('category') category: RankingCategory,
    @Query('period') period: RankingPeriod = 'weekly',
  ) {
    return this.rankings.list(category, period, current.userId);
  }
}
