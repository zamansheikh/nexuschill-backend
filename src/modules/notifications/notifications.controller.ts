import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';

import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { NotificationsService } from './notifications.service';
import { NotificationKind } from './schemas/notification.schema';

@Controller({ path: 'notifications', version: '1' })
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  /** Newest-first list of the caller's notifications.
   *
   *  Without `?kind=` the response includes both the full list and the
   *  total unread count + per-kind unread aggregation — drives the
   *  inbox page in one round trip.
   *
   *  With `?kind=` (one or more comma-separated values) the response
   *  is the filtered list only (the topic-specific page already knows
   *  which kinds it asked for). */
  @Get()
  async list(
    @CurrentUser() current: AuthenticatedUser,
    @Query('kind') rawKinds?: string,
  ) {
    const kinds = parseKinds(rawKinds);
    if (kinds.length > 0) {
      const items = await this.notifications.list(current.userId, { kinds });
      return { items };
    }
    const [items, unreadCount, unreadByKind] = await Promise.all([
      this.notifications.list(current.userId),
      this.notifications.unreadCount(current.userId),
      this.notifications.unreadCountByKind(current.userId),
    ]);
    return { items, unreadCount, unreadByKind };
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Post(':id/read')
  async markRead(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    await this.notifications.markRead(current.userId, id);
  }

  /** Reset every unread notification for the caller. Used by the
   *  inbox "Mark all read" affordance. */
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('read-all')
  async markAllRead(@CurrentUser() current: AuthenticatedUser) {
    await this.notifications.markAllRead(current.userId);
  }
}

/** Parse the `?kind=` query into a typed list. Rejects unknown values
 *  rather than silently dropping them so a typo on the client surfaces
 *  as a 400 instead of an empty result set. */
function parseKinds(raw: string | undefined): NotificationKind[] {
  if (!raw) return [];
  const valid = new Set<string>(Object.values(NotificationKind));
  const parts = raw
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  const out: NotificationKind[] = [];
  for (const p of parts) {
    if (!valid.has(p)) {
      throw new BadRequestException(`Unknown notification kind: ${p}`);
    }
    out.push(p as NotificationKind);
  }
  return out;
}
