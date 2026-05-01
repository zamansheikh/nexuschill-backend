import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { RealtimeService } from '../realtime/realtime.service';
import { RealtimeEventType } from '../realtime/realtime.types';
import { User, UserDocument } from '../users/schemas/user.schema';
import {
  Notification,
  NotificationDocument,
  NotificationKind,
  NotificationLinkKind,
} from './schemas/notification.schema';

export interface ActorView {
  id: string;
  numericId: number | null;
  displayLabel: string;
  avatarUrl: string;
}

export interface NotificationView {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  imageUrl: string;
  linkKind: NotificationLinkKind;
  linkValue: string;
  actor: ActorView | null;
  read: boolean;
  createdAt: string;
}

export interface CreateNotificationParams {
  userId: string;
  kind: NotificationKind;
  title: string;
  body?: string;
  imageUrl?: string;
  linkKind?: NotificationLinkKind;
  linkValue?: string;
  actorId?: string | null;
}

/**
 * Persists per-user notifications and fans them out over the realtime
 * gateway on the user's `user:<id>` scope. Other features call into
 * [create] when they want to drop a row in the user's inbox — there's
 * no pub/sub layer because we already have one (RealtimeService).
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectModel(Notification.name)
    private readonly notificationModel: Model<NotificationDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    private readonly realtime: RealtimeService,
  ) {}

  // ============== Reads ==============

  /** Newest-first list of notifications for a user. Bounded; the
   *  inbox doesn't paginate (yet) — once we ship deep history the
   *  client will pass a `before` cursor. */
  async list(userId: string, limit = 100): Promise<NotificationView[]> {
    const docs = await this.notificationModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .limit(Math.min(Math.max(limit, 1), 200))
      .exec();
    return this.hydrate(docs);
  }

  /** Total number of unread notifications. Drives the bottom-nav
   *  badge alongside the unread message count. */
  async unreadCount(userId: string): Promise<number> {
    return this.notificationModel
      .countDocuments({
        userId: new Types.ObjectId(userId),
        read: false,
      })
      .exec();
  }

  // ============== Writes ==============

  /** Create a notification for [params.userId] and emit it on their
   *  realtime scope. Idempotent in the sense that callers control the
   *  shape — there's no de-dupe key here. */
  async create(params: CreateNotificationParams): Promise<NotificationView> {
    if (!Types.ObjectId.isValid(params.userId)) {
      throw new BadRequestException('Invalid userId');
    }
    const created = await this.notificationModel.create({
      userId: new Types.ObjectId(params.userId),
      actorId: params.actorId ? new Types.ObjectId(params.actorId) : null,
      kind: params.kind,
      title: params.title,
      body: params.body ?? '',
      imageUrl: params.imageUrl ?? '',
      linkKind: params.linkKind ?? NotificationLinkKind.NONE,
      linkValue: params.linkValue ?? '',
      read: false,
    });
    const [view] = await this.hydrate([created]);
    await this.realtime.emit(
      `user:${params.userId}`,
      RealtimeEventType.NOTIFICATION_RECEIVED,
      { notification: view },
    );
    return view;
  }

  /** Mark a single notification read. */
  async markRead(userId: string, id: string): Promise<void> {
    if (!Types.ObjectId.isValid(id)) return;
    const result = await this.notificationModel
      .updateOne(
        {
          _id: new Types.ObjectId(id),
          userId: new Types.ObjectId(userId),
          read: false,
        },
        { $set: { read: true } },
      )
      .exec();
    if (result.modifiedCount === 0) return;
    await this.realtime.emit(
      `user:${userId}`,
      RealtimeEventType.NOTIFICATION_READ,
      { id },
    );
  }

  /** Mark every notification for the user read. Bulk-update so we
   *  don't loop in JS for big inboxes. */
  async markAllRead(userId: string): Promise<void> {
    const result = await this.notificationModel
      .updateMany(
        { userId: new Types.ObjectId(userId), read: false },
        { $set: { read: true } },
      )
      .exec();
    if (result.modifiedCount === 0) return;
    await this.realtime.emit(
      `user:${userId}`,
      RealtimeEventType.NOTIFICATION_READ,
      { id: 'all' },
    );
  }

  // ============== Helpers ==============

  private async hydrate(
    docs: NotificationDocument[],
  ): Promise<NotificationView[]> {
    if (docs.length === 0) return [];
    const actorIds = docs
      .map((d) => d.actorId)
      .filter((a): a is Types.ObjectId => a != null);
    const actors = actorIds.length > 0
      ? await this.userModel.find({ _id: { $in: actorIds } }).exec()
      : [];
    const byId = new Map(actors.map((u) => [u._id.toString(), u]));
    return docs.map((d) => this.toView(d, byId));
  }

  private toView(
    d: NotificationDocument,
    actorsById: Map<string, UserDocument>,
  ): NotificationView {
    const actor = d.actorId ? actorsById.get(d.actorId.toString()) : null;
    return {
      id: d._id.toString(),
      kind: d.kind,
      title: d.title,
      body: d.body,
      imageUrl: d.imageUrl,
      linkKind: d.linkKind,
      linkValue: d.linkValue,
      actor: actor ? this.toActor(actor) : null,
      read: d.read,
      createdAt: (d as any).createdAt?.toISOString?.() ?? '',
    };
  }

  private toActor(user: UserDocument): ActorView {
    const json = user.toJSON() as Record<string, any>;
    return {
      id: user._id.toString(),
      numericId: json.numericId ?? null,
      displayLabel:
        json.displayName ||
        json.username ||
        (json.numericId ? `User ${json.numericId}` : 'User'),
      avatarUrl: json.avatarUrl ?? '',
    };
  }
}
