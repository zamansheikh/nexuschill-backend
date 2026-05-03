import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import {
  Family,
  FamilyDocument,
} from '../families/schemas/family.schema';
import {
  FamilyMember,
  FamilyMemberDocument,
  FamilyMemberStatus,
} from '../families/schemas/family-member.schema';
import {
  GiftContext,
  GiftEvent,
  GiftEventDocument,
} from '../gifts/schemas/gift-event.schema';
import { Room, RoomDocument } from '../rooms/schemas/room.schema';
import { User, UserDocument } from '../users/schemas/user.schema';

export type RankingCategory = 'honor' | 'charm' | 'room' | 'family';
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
    @InjectModel(Family.name)
    private readonly familyModel: Model<FamilyDocument>,
    @InjectModel(FamilyMember.name)
    private readonly familyMemberModel: Model<FamilyMemberDocument>,
  ) {}

  async list(
    category: RankingCategory,
    period: RankingPeriod,
    callerUserId: string,
  ): Promise<RankingResult> {
    if (!['honor', 'charm', 'room', 'family'].includes(category)) {
      throw new BadRequestException({
        code: 'INVALID_CATEGORY',
        message: 'category must be honor / charm / room / family',
      });
    }
    if (!['daily', 'weekly', 'monthly'].includes(period)) {
      throw new BadRequestException({
        code: 'INVALID_PERIOD',
        message: 'period must be daily / weekly / monthly',
      });
    }

    const { start, end } = this.windowFor(period);
    const items = await (() => {
      switch (category) {
        case 'room':
          return this.computeRoomRanking(start, end);
        case 'family':
          return this.computeFamilyRanking(start, end);
        case 'honor':
        case 'charm':
          return this.computeUserRanking(category, start, end);
      }
    })();
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

  /**
   * Family ranking — sums every active family member's diamonds-
   * received in the window, then groups by family. The "family
   * transaction" definition matches what users see in the Family tab:
   * member earnings count toward the family's pot, so a family of
   * active hosts climbs faster than a family of pure spenders. (The
   * symmetric measure — total coins SPENT by members — could ship as
   * a parallel metric later; one number per family is enough for v1.)
   *
   * Implementation: single aggregation pipeline. The $lookup against
   * `family_members` is the heaviest step; we keep it cheap by
   * matching only `status: ACTIVE` members and by sourcing the join
   * key from an already-grouped intermediate (one row per active
   * receiver) rather than from raw gift events.
   */
  private async computeFamilyRanking(
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
          createdAt: { $gte: start, $lte: end },
        },
      },
      // Roll up per-receiver first to shrink the join input. A single
      // user receives many gift events; we only need their period
      // total to forward into the family aggregation.
      {
        $group: { _id: '$receiverId', total: { $sum: '$totalDiamondReward' } },
      },
      { $match: { total: { $gt: 0 } } },
      // Join to the user's active family membership. Users in no
      // family fall out of `$lookup` with empty array → dropped by
      // the next $unwind.
      {
        $lookup: {
          from: this.familyMemberModel.collection.name,
          let: { uid: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ['$userId', '$$uid'] },
                status: FamilyMemberStatus.ACTIVE,
              },
            },
            { $project: { familyId: 1 } },
          ],
          as: 'membership',
        },
      },
      { $unwind: '$membership' },
      {
        $group: {
          _id: '$membership.familyId',
          value: { $sum: '$total' },
        },
      },
      { $match: { value: { $gt: 0 } } },
      { $sort: { value: -1 } },
      { $limit: 100 },
    ]);

    if (rows.length === 0) return [];

    const families = await this.familyModel
      .find({ _id: { $in: rows.map((r) => r._id) } })
      .select('name numericId coverUrl level')
      .lean()
      .exec();
    const byId = new Map(families.map((f) => [f._id.toString(), f]));

    return rows.map((r, i) => {
      const fam = byId.get(r._id.toString());
      return {
        id: r._id.toString(),
        rank: i + 1,
        value: r.value,
        displayName: fam?.name ?? 'Family',
        username: null,
        numericId: fam?.numericId ?? null,
        avatarUrl: fam?.coverUrl ?? '',
        level: fam?.level ?? 1,
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

    if (category === 'family') {
      // Caller's family rank = the rank of whichever family the caller
      // is an active member of. Users with no membership get null.
      const membership = await this.familyMemberModel
        .findOne({
          userId: new Types.ObjectId(callerUserId),
          status: FamilyMemberStatus.ACTIVE,
        })
        .select('familyId')
        .lean()
        .exec();
      if (!membership) return null;
      const callerFamilyId = membership.familyId.toString();
      if (topItems.some((it) => it.id === callerFamilyId)) return null;
      return this.callerForFamily(
        callerFamilyId,
        new Types.ObjectId(callerFamilyId),
        start,
        end,
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

  /**
   * Caller's-rank computation for the family category. Mirrors
   * `callerForKey` but the value+beaters aggregations have to fan out
   * through the same family-member $lookup the main pipeline uses —
   * we can't just match on a single user-side field.
   */
  private async callerForFamily(
    callerFamilyId: string,
    callerFamilyOid: Types.ObjectId,
    start: Date,
    end: Date,
  ): Promise<RankingEntry | null> {
    // 1. The caller's family's total diamonds in the window. Same
    //    shape as the main aggregation but limited to one family.
    const sumAgg = await this.giftEventModel.aggregate<{ value: number }>([
      {
        $match: {
          status: 'completed',
          createdAt: { $gte: start, $lte: end },
        },
      },
      {
        $group: { _id: '$receiverId', total: { $sum: '$totalDiamondReward' } },
      },
      { $match: { total: { $gt: 0 } } },
      {
        $lookup: {
          from: this.familyMemberModel.collection.name,
          let: { uid: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ['$userId', '$$uid'] },
                status: FamilyMemberStatus.ACTIVE,
                familyId: callerFamilyOid,
              },
            },
            { $project: { _id: 1 } },
          ],
          as: 'membership',
        },
      },
      { $unwind: '$membership' },
      { $group: { _id: null, value: { $sum: '$total' } } },
    ]);
    const callerValue = sumAgg[0]?.value ?? 0;
    if (callerValue <= 0) {
      return this.hydrateZeroCallerRow(callerFamilyId, 'family');
    }

    // 2. Count families that beat the caller's value in the window.
    const beatersAgg = await this.giftEventModel.aggregate<{ count: number }>([
      {
        $match: {
          status: 'completed',
          createdAt: { $gte: start, $lte: end },
        },
      },
      {
        $group: { _id: '$receiverId', total: { $sum: '$totalDiamondReward' } },
      },
      { $match: { total: { $gt: 0 } } },
      {
        $lookup: {
          from: this.familyMemberModel.collection.name,
          let: { uid: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ['$userId', '$$uid'] },
                status: FamilyMemberStatus.ACTIVE,
              },
            },
            { $project: { familyId: 1 } },
          ],
          as: 'membership',
        },
      },
      { $unwind: '$membership' },
      { $group: { _id: '$membership.familyId', value: { $sum: '$total' } } },
      { $match: { value: { $gt: callerValue } } },
      { $count: 'count' },
    ]);
    const rank = (beatersAgg[0]?.count ?? 0) + 1;
    return this.hydrateCallerRow(callerFamilyId, callerValue, rank, 'family');
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
    if (category === 'family') {
      const fam = await this.familyModel
        .findById(callerSubjectId)
        .select('name numericId coverUrl level')
        .lean()
        .exec();
      if (!fam) return null;
      return {
        id: callerSubjectId,
        rank,
        value,
        displayName: fam.name ?? 'Family',
        username: null,
        numericId: fam.numericId ?? null,
        avatarUrl: fam.coverUrl ?? '',
        level: fam.level ?? 1,
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
