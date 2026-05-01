import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { NotificationsService } from '../notifications/notifications.service';
import {
  NotificationKind,
  NotificationLinkKind,
} from '../notifications/schemas/notification.schema';
import { RealtimeService } from '../realtime/realtime.service';
import { RealtimeEventType } from '../realtime/realtime.types';
import { User, UserDocument } from '../users/schemas/user.schema';
import {
  Conversation,
  ConversationDocument,
} from './schemas/conversation.schema';
import {
  Message,
  MessageDocument,
  MessageStatus,
} from './schemas/message.schema';

export interface ConversationView {
  id: string;
  /** The OTHER participant — the inbox renders the peer, never self. */
  peer: PublicUserView;
  lastMessage: {
    id: string | null;
    text: string;
    authorId: string | null;
    at: string | null;
  };
  unreadCount: number;
  updatedAt: string;
}

export interface MessageView {
  id: string;
  conversationId: string;
  authorId: string;
  recipientId: string;
  text: string;
  status: MessageStatus;
  createdAt: string;
  updatedAt: string;
}

export interface PublicUserView {
  id: string;
  numericId: number | null;
  displayLabel: string;
  avatarUrl: string;
  level: number;
}

/**
 * 1-1 messaging. Conversations are auto-created on first send (idempotent
 * — both directions resolve to the same row thanks to a sorted-pair
 * unique index). Realtime fan-out goes to `user:<id>` for both
 * participants, so the recipient sees the message instantly and the
 * sender's other devices stay in sync.
 *
 * Read tracking lives at the Conversation level rather than per-message:
 * users mark whole threads read at once, so a single counter per peer
 * (in the conversation's `unread` map) keeps the write path O(1).
 */
@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);

  constructor(
    @InjectModel(Conversation.name)
    private readonly conversationModel: Model<ConversationDocument>,
    @InjectModel(Message.name)
    private readonly messageModel: Model<MessageDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    private readonly realtime: RealtimeService,
    private readonly notifications: NotificationsService,
  ) {}

  // ============== Read paths ==============

  async listConversations(userId: string): Promise<ConversationView[]> {
    const userOid = new Types.ObjectId(userId);
    const docs = await this.conversationModel
      .find({ participants: userOid })
      .sort({ lastMessageAt: -1, updatedAt: -1 })
      .limit(100)
      .exec();

    if (docs.length === 0) return [];

    // Hydrate the OTHER participant for every conversation in one query.
    const peerIds = docs
      .map((d) => d.participants.find((p) => !p.equals(userOid)))
      .filter((p): p is Types.ObjectId => p != null);
    const peers = await this.userModel
      .find({ _id: { $in: peerIds } })
      .exec();
    const peerById = new Map(peers.map((u) => [u._id.toString(), u]));

    return docs.map((d) => {
      const peerOid = d.participants.find((p) => !p.equals(userOid));
      const peer = peerOid ? peerById.get(peerOid.toString()) : null;
      const unreadMap = d.unread ?? new Map<string, number>();
      return {
        id: d._id.toString(),
        peer: this.toPublicUser(peer),
        lastMessage: {
          id: d.lastMessageId?.toString() ?? null,
          text: d.lastMessageText ?? '',
          authorId: d.lastMessageAuthorId?.toString() ?? null,
          at: d.lastMessageAt?.toISOString() ?? null,
        },
        unreadCount: unreadMap.get(userId) ?? 0,
        updatedAt: (d as any).updatedAt?.toISOString?.() ?? '',
      };
    });
  }

  /** Paginated message history. Newest-first ordering matches the inbox
   *  contract; the client reverses for top-down display. */
  async listMessages(
    userId: string,
    conversationId: string,
    opts: { before?: string; limit?: number },
  ): Promise<MessageView[]> {
    if (!Types.ObjectId.isValid(conversationId)) {
      throw new BadRequestException('Invalid conversation id');
    }
    const convo = await this.conversationModel.findById(conversationId).exec();
    if (!convo) throw new NotFoundException('Conversation not found');
    if (!convo.participants.some((p) => p.toString() === userId)) {
      throw new NotFoundException('Conversation not found');
    }

    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
    const filter: Record<string, unknown> = {
      conversationId: convo._id,
      status: MessageStatus.ACTIVE,
    };
    if (opts.before && Types.ObjectId.isValid(opts.before)) {
      filter._id = { $lt: new Types.ObjectId(opts.before) };
    }
    const docs = await this.messageModel
      .find(filter)
      .sort({ _id: -1 })
      .limit(limit)
      .exec();
    return docs.map((d) => this.toMessageView(d));
  }

  // ============== Write paths ==============

  async sendMessage(
    fromUserId: string,
    toUserId: string,
    text: string,
  ): Promise<{ message: MessageView; conversation: ConversationView }> {
    if (fromUserId === toUserId) {
      throw new BadRequestException('Cannot message yourself');
    }
    if (!Types.ObjectId.isValid(toUserId)) {
      throw new BadRequestException('Invalid recipient id');
    }
    const trimmed = text.trim();
    if (!trimmed) throw new BadRequestException('Message text required');

    const recipient = await this.userModel.findById(toUserId).exec();
    if (!recipient) throw new NotFoundException('Recipient not found');

    const fromOid = new Types.ObjectId(fromUserId);
    const toOid = new Types.ObjectId(toUserId);
    const conversation = await this.findOrCreateConversation(fromOid, toOid);

    const now = new Date();
    const created = await this.messageModel.create({
      conversationId: conversation._id,
      authorId: fromOid,
      recipientId: toOid,
      text: trimmed,
      status: MessageStatus.ACTIVE,
    });

    // Bump the conversation's preview + unread counter for the recipient.
    // We don't bump the sender's counter — a user who just sent a message
    // hasn't accumulated unread state for themselves.
    const unread = conversation.unread ?? new Map<string, number>();
    const prevUnread = unread.get(toUserId) ?? 0;
    unread.set(toUserId, prevUnread + 1);
    unread.set(fromUserId, unread.get(fromUserId) ?? 0);

    conversation.lastMessageId = created._id;
    conversation.lastMessageText = trimmed;
    conversation.lastMessageAuthorId = fromOid;
    conversation.lastMessageAt = now;
    conversation.unread = unread;
    await conversation.save();

    const messageView = this.toMessageView(created);
    const fromConvoView = await this.toConversationViewFor(
      conversation,
      fromUserId,
    );
    const toConvoView = await this.toConversationViewFor(
      conversation,
      toUserId,
    );

    // Fan out. Recipient's `user:<toUserId>` scope drives their inbox +
    // chat-thread updates; sender's own scope keeps any other connected
    // device of theirs in sync.
    await this.realtime.emit(
      `user:${toUserId}`,
      RealtimeEventType.MESSAGE_RECEIVED,
      { message: messageView, conversation: toConvoView },
    );
    await this.realtime.emit(
      `user:${fromUserId}`,
      RealtimeEventType.MESSAGE_RECEIVED,
      { message: messageView, conversation: fromConvoView },
    );

    // Drop a notification on every new message. The Notifications tab
    // is the user's "you have unread chats elsewhere in the app"
    // surface — fan-in across conversations is the point. Aggregation
    // (collapsing repeat senders) can land later as an inbox-side
    // grouping; for now duplicates are fine and FCM-equivalent.
    const senderJson = (
      await this.userModel.findById(fromOid).exec()
    )?.toJSON() as Record<string, any> | null;
    const senderLabel =
      senderJson?.displayName ||
      senderJson?.username ||
      (senderJson?.numericId ? `User ${senderJson.numericId}` : 'Someone');
    await this.notifications.create({
      userId: toUserId,
      actorId: fromUserId,
      kind: NotificationKind.MESSAGE,
      title: `${senderLabel} sent you a message`,
      body: trimmed,
      // Tap → opens the 1-1 thread for this peer.
      linkKind: NotificationLinkKind.CHAT,
      linkValue: fromUserId,
    });

    return { message: messageView, conversation: fromConvoView };
  }

  /** Mark every message in [conversationId] as read for [userId]. Resets
   *  this user's unread counter on the conversation; the OTHER user's
   *  counter is untouched. Emits MESSAGE_READ on the user's own scope so
   *  their other devices clear the badge too. */
  async markRead(userId: string, conversationId: string): Promise<void> {
    if (!Types.ObjectId.isValid(conversationId)) {
      throw new BadRequestException('Invalid conversation id');
    }
    const convo = await this.conversationModel.findById(conversationId).exec();
    if (!convo) return;
    if (!convo.participants.some((p) => p.toString() === userId)) return;

    const unread = convo.unread ?? new Map<string, number>();
    if ((unread.get(userId) ?? 0) === 0) return;

    unread.set(userId, 0);
    convo.unread = unread;
    await convo.save();

    await this.realtime.emit(
      `user:${userId}`,
      RealtimeEventType.MESSAGE_READ,
      { conversationId: convo._id.toString() },
    );
  }

  // ============== Internal helpers ==============

  private async findOrCreateConversation(
    a: Types.ObjectId,
    b: Types.ObjectId,
  ): Promise<ConversationDocument> {
    // Sort participants ascending so both directions (A→B, B→A) resolve
    // to the same indexed key.
    const sorted = [a, b].sort((x, y) => x.toString().localeCompare(y.toString()));
    const existing = await this.conversationModel
      .findOne({ participants: sorted })
      .exec();
    if (existing) return existing;
    try {
      return await this.conversationModel.create({
        participants: sorted,
        unread: new Map<string, number>([
          [sorted[0].toString(), 0],
          [sorted[1].toString(), 0],
        ]),
      });
    } catch (err: any) {
      // Race on the unique index — re-fetch and use the winning row.
      if (err?.code === 11000) {
        const winner = await this.conversationModel
          .findOne({ participants: sorted })
          .exec();
        if (winner) return winner;
      }
      throw err;
    }
  }

  private toMessageView(d: MessageDocument): MessageView {
    return {
      id: d._id.toString(),
      conversationId: d.conversationId.toString(),
      authorId: d.authorId.toString(),
      recipientId: d.recipientId.toString(),
      text: d.text,
      status: d.status,
      createdAt: (d as any).createdAt?.toISOString?.() ?? '',
      updatedAt: (d as any).updatedAt?.toISOString?.() ?? '',
    };
  }

  private async toConversationViewFor(
    convo: ConversationDocument,
    forUserId: string,
  ): Promise<ConversationView> {
    const peerOid = convo.participants.find((p) => p.toString() !== forUserId);
    const peer = peerOid
      ? await this.userModel.findById(peerOid).exec()
      : null;
    const unread = convo.unread ?? new Map<string, number>();
    return {
      id: convo._id.toString(),
      peer: this.toPublicUser(peer),
      lastMessage: {
        id: convo.lastMessageId?.toString() ?? null,
        text: convo.lastMessageText ?? '',
        authorId: convo.lastMessageAuthorId?.toString() ?? null,
        at: convo.lastMessageAt?.toISOString() ?? null,
      },
      unreadCount: unread.get(forUserId) ?? 0,
      updatedAt: (convo as any).updatedAt?.toISOString?.() ?? '',
    };
  }

  private toPublicUser(user: UserDocument | null | undefined): PublicUserView {
    if (!user) {
      return {
        id: '',
        numericId: null,
        displayLabel: 'Unknown',
        avatarUrl: '',
        level: 1,
      };
    }
    const json = user.toJSON() as Record<string, any>;
    return {
      id: user._id.toString(),
      numericId: json.numericId ?? null,
      displayLabel:
        json.displayName ||
        json.username ||
        (json.numericId ? `User ${json.numericId}` : 'User'),
      avatarUrl: json.avatarUrl ?? '',
      level: json.level ?? 1,
    };
  }
}
