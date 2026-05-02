import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';

import { AuthenticatedUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { TrackMicDto } from './dto/magic-ball.dto';
import { MagicBallService } from './magic-ball.service';

/**
 * User-facing Magic Ball endpoints. Admin task CRUD lives on
 * admin-magic-ball.controller.ts under /admin/magic-ball.
 */
@Controller({ path: 'magic-ball', version: '1' })
export class MagicBallController {
  constructor(private readonly svc: MagicBallService) {}

  /** Today's tasks + my progress + cumulative reward total. */
  @Get('me')
  async me(@CurrentUser() current: AuthenticatedUser) {
    const summary = await this.svc.getMySummary(current.userId);
    // Flatten for the wire — controllers shouldn't return Mongoose docs
    // raw, but the toJSON transform on the schema already does the
    // right thing. We rely on Nest's interceptor stack to serialise.
    return {
      dayKey: summary.dayKey,
      cumulativeCoinsAllTime: summary.cumulativeCoinsAllTime,
      todayClaimedCoins: summary.todayClaimedCoins,
      tasks: summary.tasks.map((t) => ({
        task: t.task,
        progress: t.progress,
        completed: t.completed,
        claimed: t.claimed,
      })),
    };
  }

  /** Claim a completed task → credits the user's coin wallet. */
  @Post('claim/:taskId')
  @HttpCode(HttpStatus.OK)
  async claim(
    @CurrentUser() current: AuthenticatedUser,
    @Param('taskId') taskId: string,
  ) {
    const result = await this.svc.claimReward(current.userId, taskId);
    return result;
  }

  /**
   * Mobile reports a finished mic session. Will eventually be replaced
   * by a server-side hook on RoomsService.leaveSeat — until then the
   * client is the source of truth, and the service rounds the supplied
   * seconds to whole minutes before incrementing the `mic_minutes`
   * counter.
   */
  @Post('track-mic')
  @HttpCode(HttpStatus.OK)
  async trackMic(
    @CurrentUser() current: AuthenticatedUser,
    @Body() dto: TrackMicDto,
  ) {
    await this.svc.recordMicSessionSeconds(current.userId, dto.seconds);
    return { success: true };
  }
}
