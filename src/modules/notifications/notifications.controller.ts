import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';

import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { NotificationsService } from './notifications.service';

@Controller({ path: 'notifications', version: '1' })
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  /** Newest-first list of the caller's notifications, plus the unread
   *  count so the inbox can render the bottom-nav badge in one round
   *  trip. */
  @Get()
  async list(@CurrentUser() current: AuthenticatedUser) {
    const [items, unreadCount] = await Promise.all([
      this.notifications.list(current.userId),
      this.notifications.unreadCount(current.userId),
    ]);
    return { items, unreadCount };
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
