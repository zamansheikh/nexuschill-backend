import { Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';

import { AuthenticatedUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { DailyRewardService } from './daily-reward.service';

@Controller({ path: 'me/daily-reward', version: '1' })
@UseGuards(JwtAuthGuard)
export class DailyRewardController {
  constructor(private readonly daily: DailyRewardService) {}

  /**
   * State the user needs to render the modal:
   *   • the full 7-day config (so all tiles can be drawn)
   *   • their currentStreak so claimed days show as "claimed"
   *   • todayDay (1..7) — the tile to highlight
   *   • canClaim — whether to show the active "Sign In" button
   */
  @Get()
  async myState(@CurrentUser() current: AuthenticatedUser) {
    return this.daily.getStateForUser(current.userId);
  }

  @HttpCode(HttpStatus.OK)
  @Post('claim')
  async claim(@CurrentUser() current: AuthenticatedUser) {
    return this.daily.claim(current.userId);
  }
}
