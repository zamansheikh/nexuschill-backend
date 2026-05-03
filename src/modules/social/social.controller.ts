import {
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';

import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { SocialService } from './social.service';

/**
 * Social-graph + visitor endpoints. Routes are split between
 * `/users/:id/...` (target-user-scoped: anyone can read another user's
 * followers / following lists, only the caller can follow / unfollow)
 * and `/users/me/visitors` (self-scoped — visitor lists are private,
 * so no read access for other users' visitors).
 *
 * Visit tracking has a dedicated `POST /users/:id/visit` so the
 * mobile profile-view can fire-and-forget without blocking the
 * profile fetch — it's recorded server-side regardless of whether
 * the client awaits the response.
 */
@Controller({ version: '1' })
export class SocialController {
  constructor(private readonly social: SocialService) {}

  // ============== Follow ==============

  @Post('users/:id/follow')
  async follow(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.social.follow(current.userId, id);
  }

  @Delete('users/:id/follow')
  async unfollow(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.social.unfollow(current.userId, id);
  }

  @Get('users/:id/followers')
  async followers(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id') id: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.social.listFollowers(id, current.userId, { page, limit });
  }

  @Get('users/:id/following')
  async following(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id') id: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.social.listFollowing(id, current.userId, { page, limit });
  }

  // ============== Visitors ==============

  /** Record a profile visit. Called by the mobile app whenever the
   *  user opens someone else's profile page. Self-visits and
   *  malformed ids no-op silently — the response is intentionally
   *  empty so the client treats this as fire-and-forget. */
  @Post('users/:id/visit')
  async recordVisit(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    await this.social.recordVisit(current.userId, id);
    return { ok: true };
  }

  /** Caller's own visitors list. No `:id` form because visitor data
   *  is private — only the visited user gets to see who's been on
   *  their profile. */
  @Get('users/me/visitors')
  async myVisitors(
    @CurrentUser() current: AuthenticatedUser,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.social.listVisitors(current.userId, current.userId, {
      page,
      limit,
    });
  }
}
