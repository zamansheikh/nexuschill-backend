import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import {
  GiftContext,
  GiftEvent,
  GiftEventDocument,
} from '../gifts/schemas/gift-event.schema';
import { Room, RoomDocument } from '../rooms/schemas/room.schema';
import { User, UserDocument } from '../users/schemas/user.schema';

export type RankingCategory = 'honor' | 'charm' | 'room';
export type RankingPeriod = 'daily' | 'weekly' | 'monthly';

export interface RankingEntry {
  /** Subject id — userId for honor/charm, roomId for room. */
  id: string;
  rank: number;
  /** Honor & charm: total coins / diamonds in the period. Room: total
   *  diamonds the room received. The unit (coin / diamond) follows
   *  the category and is rendered by the client. */
  value: number;
  displayName: string;
  username: string | null;
  numericId: number | null;
  avatarUrl: string;
  level: number;
  /** Room category only — populated with the room's owner avatar so
   *  the podium can fall back to the host's face when the room has
   *  no cover. Null for honor / charm rows. */
  ownerAvatarUrl?: string | null;
}

export interface RankingResult {
  category: RankingCategory;
  period: RankingPeriod;
  /** UTC ISO strings — the client renders the "Time period 04/05 ~
   *  10/05" header from these. */
  periodStart: string;
  periodEnd: string;
  /** Ordered top-N. Limit is fixed at 100; the UI only ever paginates
   *  client-side because rankings tail off well before 100. */
  items: RankingEntry[];
  /** Caller's own row when they're outside the top 100. Null when
   *  they're already in `items` or have no qualifying activity. The
   *  mobile sticky footer renders this. */
  callerEntry: RankingEntry | null;
}

/**
 * Three platform-wide leaderboards (honor / charm / room) over three
 * windows (daily / weekly / monthly). Data is computed live via a
 * Mongo aggregation pipeline against `GiftEvent` — there's no
 * pre-aggregated leaderboard table.
 *
 * Why live-compute: the home page hits this on demand (rail tap) and
 * the GiftEvent collection is already indexed on `(senderId,
 * createdAt)` and `(receiverId, createdAt)`. A pipeline over a single
 * day or week of gift events runs in milliseconds at our scale; if
 * traffic ever forces the issue, we'll cache the previous window's
 * result in Redis with a 5-minute TTL — but that's premature today.
 */
@Injectable()
export class RankingsService {
  constructor(
    @InjectModel(GiftEvent.name)
    private readonly giftEventModel: Model<GiftEventDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Room.name) private readonly roomModel: Model<RoomDocument>,
  ) {}

  async list(
    category: RankingCategory,
    period: RankingPeriod,
    callerUserId: string,
  ): Promise<RankingResult> {
    if (!['honor', 'charm', 'room'].includes(category)) {
      throw new BadRequestException({
        code: 'INVALID_CATEGORY',
        message: 'category must be honor / charm / room',
      });
    }
    if (!['daily', 'weekly', 'monthly'].includes(period)) {
      throw new BadRequestException({
        code: 'INVALID_PERIOD',
        message: 'period must be daily / weekly / monthly',
      });
    }

    const { start, end } = this.windowFor(period);
    const items =
      category === 'room'
        ? await this.computeRoomRanking(start, end)
        : await this.computeUserRanking(category, start, end);
    const callerEntry = await this.computeCallerEntry(
      category,
      start,
      end,
      callerUserId,
      items,
    );

    return {
      category,
      period,
      periodStart: start.toISOString(),
      periodEnd: end.toISOString(),
      items,
      callerEntry,
    };
  }

  // ============== Pipelines ==============

  private async computeUserRanking(
    category: 'honor' | 'charm',
    start: Date,
    end: Date,
  ): Promise<RankingEntry[]> {
    const groupKey = category === 'honor' ? '$senderId' : '$receiverId';
    const valueField =
      category === 'honor' ? '$totalCoinAmount' : '$totalDiamondReward';

    const rows = await this.giftEventModel.aggregate<{
      _id: Types.ObjectId;
      value: number;
    }>([
      {
        $match: {
          status: 'completed',
          createdAt: { $gte: start, $lte: end },
        },
      },
      { $group: { _id: groupKey, value: { $sum: valueField } } },
      { $match: { value: { $gt: 0 } } },
      { $sort: { value: -1 } },
      { $limit: 100 },
    ]);

    if (rows.length === 0) return [];

    // One round trip to hydrate the display fields.
    const users = await this.userModel
      .find({ _id: { $in: rows.map((r) => r._id) } })
      .select('username displayName avatarUrl numericId level')
      .lean()
      .exec();
    const byId = new Map(users.map((u) => [u._id.toString(), u]));

    return rows.map((r, i) => {
      const u = byId.get(r._id.toString());
      return {
        id: r._id.toString(),
        rank: i + 1,
        value: r.value,
        displayName: u?.displayName ?? '',
        username: u?.username ?? null,
        numericId: u?.numericId ?? null,
        avatarUrl: u?.avatarUrl ?? '',
        level: u?.level ?? 1,
      };
    });
  }

  private async computeRoomRanking(
    start: Date,
    end: Date,
  ): Promise<RankingEntry[]> {
    const rows = await this.giftEventModel.aggregate<{
      _id: Types.ObjectId;
      value: number;
    }>([
      {
        $match: {
          status: 'completed',
          contextType: GiftContext.ROOM,
          contextId: { $ne: null },
          createdAt: { $gte: start, $lte: end },
        },
      },
      { $group: { _id: '$contextId', value: { $sum: '$totalDiamondReward' } } },
      { $match: { value: { $gt: 0 } } },
      { $sort: { value: -1 } },
      { $limit: 100 },
    ]);

    if (rows.length === 0) return [];

    // Hydrate room display fields + owner avatar fallback.
    const rooms = await this.roomModel
      .find({ _id: { $in: rows.map((r) => r._id) } })
      .select('name numericId coverUrl ownerId')
      .populate('ownerId', 'displayName avatarUrl')
      .lean()
      .exec();
    const byId = new Map(rooms.map((r) => [r._id.toString(), r]));

    return rows.map((r, i) => {
      const room = byId.get(r._id.toString()) as
        | (Record<string, any> & { ownerId?: any })
        | undefined;
      const owner =
        room && typeof room.ownerId === 'object' ? room.ownerId : null;
      return {
        id: r._id.toString(),
        rank: i + 1,
        value: r.value,
        displayName: room?.name ?? 'Room',
        username: null,
        numericId: room?.numericId ?? null,
        avatarUrl: room?.coverUrl ?? owner?.avatarUrl ?? '',
        level: 0,
        ownerAvatarUrl: owner?.avatarUrl ?? null,
      };
    });
  }

  // ============== Caller's own rank ==============

  private async computeCallerEntry(
    category: RankingCategory,
    start: Date,
    end: Date,
    callerUserId: string,
    topItems: RankingEntry[],
  ): Promise<RankingEntry | null> {
    if (!Types.ObjectId.isValid(callerUserId)) return null;
    // Already in the top? No need to re-emit.
    if (topItems.some((it) => it.id === callerUserId)) return null;

    if (category === 'room') {
      // The caller's "rank" in the room category = the rank of the
      // room they own (if any). Skip if they don't own a room.
      const room = await this.roomModel
        .findOne({ ownerId: new Types.ObjectId(callerUserId) })
        .select('_id')
        .lean()
        .exec();
      if (!room) return null;
      const callerRoomId = room._id.toString();
      if (topItems.some((it) => it.id === callerRoomId)) return null;
      return this.callerForKey(
        callerRoomId,
        new Types.ObjectId(callerRoomId),
        '$contextId',
        '$totalDiamondReward',
        start,
        end,
        'room',
        { contextType: GiftContext.ROOM },
      );
    }

    return this.callerForKey(
      callerUserId,
      new Types.ObjectId(callerUserId),
      category === 'honor' ? '$senderId' : '$receiverId',
      category === 'honor' ? '$totalCoinAmount' : '$totalDiamondReward',
      start,
      end,
      category,
      {},
    );
  }

  /**
   * Compute the caller's value + rank for one category + period. Two
   * tiny aggregations: one to sum the caller's own value, one to count
   * how many distinct subjects beat it. Cheap because both are
   * indexed-only matches; we never need to scan the full leaderboard
   * once it's been grouped.
   */
  private async callerForKey(
    callerSubjectId: string,
    callerSubjectOid: Types.ObjectId,
    groupKey: string,
    valueField: string,
    start: Date,
    end: Date,
    category: RankingCategory,
    extraMatch: Record<string, unknown>,
  ): Promise<RankingEntry | null> {
    // 1. Caller's own total in the window.
    const matchKey = groupKey.replace('$', '');
    const sumAgg = await this.giftEventModel.aggregate<{ value: number }>([
      {
        $match: {
          status: 'completed',
          createdAt: { $gte: start, $lte: end },
          [matchKey]: callerSubjectOid,
          ...extraMatch,
        },
      },
      { $group: { _id: null, value: { $sum: valueField } } },
    ]);
    const callerValue = sumAgg[0]?.value ?? 0;
    if (callerValue <= 0) {
      return this.hydrateZeroCallerRow(callerSubjectId, category);
    }

    // 2. How many distinct subjects beat the caller? Their rank is
    //    that count + 1.
    const beatersAgg = await this.giftEventModel.aggregate<{ count: number }>([
      {
        $match: {
          status: 'completed',
          createdAt: { $gte: start, $lte: end },
          ...extraMatch,
        },
      },
      { $group: { _id: groupKey, value: { $sum: valueField } } },
      { $match: { value: { $gt: callerValue } } },
      { $count: 'count' },
    ]);
    const rank = (beatersAgg[0]?.count ?? 0) + 1;

    return this.hydrateCallerRow(callerSubjectId, callerValue, rank, category);
  }

  /** Caller has zero activity this window — still return a row so the
   *  sticky footer renders consistently. Rank `0` is the convention
   *  the mobile side reads as "100+". */
  private async hydrateZeroCallerRow(
    callerSubjectId: string,
    category: RankingCategory,
  ): Promise<RankingEntry | null> {
    return this.hydrateCallerRow(callerSubjectId, 0, 0, category);
  }

  private async hydrateCallerRow(
    callerSubjectId: string,
    value: number,
    rank: number,
    category: RankingCategory,
  ): Promise<RankingEntry | null> {
    if (category === 'room') {
      const room = await this.roomModel
        .findById(callerSubjectId)
        .select('name numericId coverUrl ownerId')
        .populate('ownerId', 'displayName avatarUrl')
        .lean()
        .exec();
      if (!room) return null;
      const owner =
        typeof (room as any).ownerId === 'object'
          ? ((room as any).ownerId as { avatarUrl?: string })
          : null;
      return {
        id: callerSubjectId,
        rank,
        value,
        displayName: room.name ?? 'Room',
        username: null,
        numericId: room.numericId ?? null,
        avatarUrl: room.coverUrl ?? owner?.avatarUrl ?? '',
        level: 0,
        ownerAvatarUrl: owner?.avatarUrl ?? null,
      };
    }
    const u = await this.userModel
      .findById(callerSubjectId)
      .select('username displayName avatarUrl numericId level')
      .lean()
      .exec();
    if (!u) return null;
    return {
      id: callerSubjectId,
      rank,
      value,
      displayName: u.displayName ?? '',
      username: u.username ?? null,
      numericId: u.numericId ?? null,
      avatarUrl: u.avatarUrl ?? '',
      level: u.level ?? 1,
    };
  }

  // ============== Period windows ==============

  /**
   * Map a period name to its [start, end] window in UTC. Boundaries
   * match the UI:
   *   • daily   — today 00:00 → 23:59:59.999
   *   • weekly  — current Monday 00:00 → following Sunday 23:59:59.999
   *   • monthly — first day of current month 00:00 → last day 23:59
   *
   * UTC throughout so all clients see the same "today" — we don't run
   * region-locked leaderboards yet.
   */
  private windowFor(period: RankingPeriod): { start: Date; end: Date } {
    const now = new Date();
    if (period === 'daily') {
      const start = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
      );
      const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
      return { start, end };
    }
    if (period === 'monthly') {
      const start = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
      );
      const end = new Date(
        Date.UTC(
          now.getUTCFullYear(),
          now.getUTCMonth() + 1,
          1,
          0,
          0,
          0,
          -1,
        ),
      );
      return { start, end };
    }
    // weekly — Monday-Sunday window. JS Sunday=0 ... Saturday=6.
    const dayOfWeek = now.getUTCDay();
    const daysFromMonday = (dayOfWeek + 6) % 7;
    const start = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    start.setUTCDate(start.getUTCDate() - daysFromMonday);
    const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000 - 1);
    return { start, end };
  }
}
