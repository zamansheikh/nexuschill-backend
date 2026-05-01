import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { AdminOnly } from '../admin/admin-auth/decorators/admin-only.decorator';
import { RequirePermissions } from '../admin/admin-auth/decorators/require-permissions.decorator';
import { PERMISSIONS } from '../admin/permissions.catalog';
import { User, UserDocument } from '../users/schemas/user.schema';
import { AdminPushNotificationDto } from './dto/push-notification.dto';
import { NotificationsService } from './notifications.service';
import {
  NotificationKind,
  NotificationLinkKind,
} from './schemas/notification.schema';

@Controller({ path: 'admin/notifications', version: '1' })
@AdminOnly()
export class NotificationsAdminController {
  private readonly logger = new Logger(NotificationsAdminController.name);

  constructor(
    private readonly notifications: NotificationsService,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {}

  /** Compose + fan a push notification. Each targeted user gets:
   *   • a row in their in-app Notifications inbox
   *   • a realtime push (if their socket is connected)
   *   • an FCM push (if they have any registered device tokens)
   *
   *  Audience options:
   *   • `target.type = 'users'` with explicit ids — direct send.
   *   • `target.type = 'all'` — every active user. Bounded by the
   *     query inside (caps at the active set; banned/suspended are
   *     excluded). Use with care; this is the announcement path.
   */
  @RequirePermissions(PERMISSIONS.NOTIFICATIONS_PUSH)
  @HttpCode(HttpStatus.OK)
  @Post('push')
  async push(@Body() dto: AdminPushNotificationDto) {
    const userIds = await this.resolveTargets(dto);
    if (userIds.length === 0) {
      throw new BadRequestException(
        'Target resolves to zero users — nothing to send',
      );
    }

    const params = {
      kind: dto.kind ?? NotificationKind.SYSTEM,
      title: dto.title,
      body: dto.body ?? '',
      imageUrl: dto.imageUrl ?? '',
      linkKind: dto.linkKind ?? NotificationLinkKind.NONE,
      linkValue: dto.linkValue ?? '',
    };

    // Sequential creates so each user gets their own row + realtime
    // emit + FCM push. We run in batches to avoid spawning thousands
    // of awaits at once. FCM fan-out inside `notifications.create`
    // is fire-and-forget, so the latency here is bounded by the
    // database write per row.
    const BATCH = 50;
    let created = 0;
    for (let i = 0; i < userIds.length; i += BATCH) {
      const slice = userIds.slice(i, i + BATCH);
      await Promise.all(
        slice.map((uid) =>
          this.notifications
            .create({ ...params, userId: uid })
            .catch((e) =>
              this.logger.warn(
                `Push to ${uid} failed: ${(e as Error).message}`,
              ),
            ),
        ),
      );
      created += slice.length;
    }

    return { delivered: created };
  }

  // ============== Internals ==============

  private async resolveTargets(
    dto: AdminPushNotificationDto,
  ): Promise<string[]> {
    if (dto.target.type === 'users') {
      const ids = (dto.target.userIds ?? []).filter((id) =>
        Types.ObjectId.isValid(id),
      );
      if (ids.length === 0) {
        throw new BadRequestException(
          '`userIds` is required when target.type = "users"',
        );
      }
      return Array.from(new Set(ids));
    }
    // `all` — pull every active user. Limited to a single query since
    // we just need ids; hydration happens per-user in `create`.
    const docs = await this.userModel
      .find({ status: 'active' })
      .select('_id')
      .lean()
      .exec();
    return docs.map((d) => d._id.toString());
  }
}
