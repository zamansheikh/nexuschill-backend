import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import {
  GiftContext,
  GiftEvent,
  GiftEventDocument,
} from '../gifts/schemas/gift-event.schema';
import {
  RoomMember,
  RoomMemberDocument,
} from '../rooms/schemas/room-member.schema';
import { Room, RoomDocument } from '../rooms/schemas/room.schema';
import {
  RoomSupportConfig,
  RoomSupportConfigDocument,
  RoomSupportLevel,
} from './schemas/room-support-config.schema';

const SINGLETON_KEY = 'singleton';

/**
 * Asia/Dhaka is UTC+05:30 with no DST, so a fixed offset is correct here.
 * If the platform expands to a DST market this needs `Intl.DateTimeFormat`
 * with the configured tz from RoomSupportConfig.timezone.
 */
const TZ_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Default reward ladder pulled from the in-app screenshot. ownerCoins +
 * partnerCoins * partnerSlots = totalCoins on each row (verified). Admin
 * can replace this via PATCH /admin/room-support/config later.
 */
const DEFAULT_LEVELS: RoomSupportLevel[] = [
  {
    level: 1,
    minVisitors: 20,
    minCoins: 3_000_000,
    ownerCoins: 330_000,
    partnerCoins: 90_000,
    partnerSlots: 1,
    totalCoins: 420_000,
  },
  {
    level: 2,
    minVisitors: 50,
    minCoins: 6_000_000,
    ownerCoins: 660_000,
    partnerCoins: 120_000,
    partnerSlots: 2,
    totalCoins: 900_000,
  },
  {
    level: 3,
    minVisitors: 75,
    minCoins: 12_000_000,
    ownerCoins: 1_300_000,
    partnerCoins: 170_000,
    partnerSlots: 3,
    totalCoins: 1_810_000,
  },
];

interface WeekBounds {
  thisWeekStart: Date;
  thisWeekEnd: Date;
  lastWeekStart: Date;
  lastWeekEnd: Date;
  nextRewardAt: Date;
}

interface MetricRow {
  visitors: number;
  coins: number;
  level: number; // 0 = no reward tier reached yet
  rewardCoins: number; // owner's projected reward at the achieved level (0 if level=0)
}

export interface MyRoomSupportSummary {
  /** Resolved owned room (just one — the audio room). null if user owns none. */
  room: {
    id: string;
    name: string;
    numericId?: number | null;
  } | null;
  thisWeek: MetricRow;
  lastWeek: MetricRow;
  nextRewardAt: string; // ISO
  weekStart: string; // ISO of this week's Monday 00:00 local
  weekEnd: string; // ISO of this week's Sunday 23:59 local
}

export interface RankingEntry {
  rank: number;
  roomId: string;
  roomName: string;
  ownerId: string;
  coins: number;
  visitors: number;
  level: number;
}

@Injectable()
export class RoomSupportService {
  constructor(
    @InjectModel(RoomSupportConfig.name)
    private readonly configModel: Model<RoomSupportConfigDocument>,
    @InjectModel(Room.name) private readonly roomModel: Model<RoomDocument>,
    @InjectModel(RoomMember.name)
    private readonly memberModel: Model<RoomMemberDocument>,
    @InjectModel(GiftEvent.name)
    private readonly giftEventModel: Model<GiftEventDocument>,
  ) {}

  // ============================================================
  // Config
  // ============================================================

  /**
   * Lazy-upsert config singleton. First read on a fresh deployment seeds
   * the default ladder so the mobile screen has data to render even
   * before any admin touches the doc.
   */
  async getConfig(): Promise<RoomSupportConfigDocument> {
    return this.configModel
      .findOneAndUpdate(
        { key: SINGLETON_KEY },
        {
          $setOnInsert: {
            key: SINGLETON_KEY,
            timezone: 'Asia/Dhaka',
            levels: DEFAULT_LEVELS,
            enabled: true,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();
  }

  async updateConfig(update: {
    /** `totalCoins` is optional on input — server recomputes from owner+partner. */
    levels?: Array<Omit<RoomSupportLevel, 'totalCoins'> & { totalCoins?: number }>;
    timezone?: string;
    enabled?: boolean;
  }): Promise<RoomSupportConfigDocument> {
    const set: Record<string, unknown> = {};
    if (update.levels !== undefined) {
      // Keep ladder sorted by level + recompute totalCoins so callers can't
      // submit inconsistent rows.
      set.levels = [...update.levels]
        .sort((a, b) => a.level - b.level)
        .map((l) => ({
          ...l,
          totalCoins: l.ownerCoins + l.partnerCoins * l.partnerSlots,
        }));
    }
    if (update.timezone !== undefined) set.timezone = update.timezone;
    if (update.enabled !== undefined) set.enabled = update.enabled;
    return this.configModel
      .findOneAndUpdate(
        { key: SINGLETON_KEY },
        { $set: set, $setOnInsert: { key: SINGLETON_KEY } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();
  }

  // ============================================================
  // Weekly metrics for the caller
  // ============================================================

  async getMySummary(userId: string): Promise<MyRoomSupportSummary> {
    const config = await this.getConfig();
    const bounds = this.weekBounds(new Date());

    // Resolve the caller's owned audio room. They might own a video room
    // separately; for Phase 1 the page focuses on the audio one (matches
    // the in-app reference). Returning the first owned room of any kind
    // would also be acceptable; revisit when video rooms ship.
    let room: RoomDocument | null = null;
    if (Types.ObjectId.isValid(userId)) {
      room = await this.roomModel
        .findOne({ ownerId: new Types.ObjectId(userId) })
        .sort({ kind: 1 }) // 'audio' < 'video' alphabetically
        .exec();
    }

    if (!room) {
      // No owned room → still return the bounds so the UI can render the
      // countdown correctly even with an empty stat row.
      const empty: MetricRow = { visitors: 0, coins: 0, level: 0, rewardCoins: 0 };
      return {
        room: null,
        thisWeek: empty,
        lastWeek: empty,
        nextRewardAt: bounds.nextRewardAt.toISOString(),
        weekStart: bounds.thisWeekStart.toISOString(),
        weekEnd: bounds.thisWeekEnd.toISOString(),
      };
    }

    const [thisWeek, lastWeek] = await Promise.all([
      this.aggregateRoomMetrics(
        room._id,
        bounds.thisWeekStart,
        bounds.thisWeekEnd,
        config.levels,
      ),
      this.aggregateRoomMetrics(
        room._id,
        bounds.lastWeekStart,
        bounds.lastWeekEnd,
        config.levels,
      ),
    ]);

    return {
      room: {
        id: room._id.toString(),
        name: room.name ?? '',
        numericId: room.numericId ?? null,
      },
      thisWeek,
      lastWeek,
      nextRewardAt: bounds.nextRewardAt.toISOString(),
      weekStart: bounds.thisWeekStart.toISOString(),
      weekEnd: bounds.thisWeekEnd.toISOString(),
    };
  }

  // ============================================================
  // Ranking
  // ============================================================

  /**
   * Top-N rooms ranked by total coins received this week. Joined back to
   * Room metadata so the mobile list can render names + ids without a
   * second roundtrip per row.
   */
  async getRanking(limit: number = 50): Promise<RankingEntry[]> {
    const config = await this.getConfig();
    const bounds = this.weekBounds(new Date());

    // Aggregate gift coins per roomId for the current week.
    const agg = await this.giftEventModel
      .aggregate<{ _id: Types.ObjectId; coins: number }>([
        {
          $match: {
            contextType: GiftContext.ROOM,
            contextId: { $ne: null },
            createdAt: { $gte: bounds.thisWeekStart, $lte: bounds.thisWeekEnd },
          },
        },
        {
          $group: {
            _id: '$contextId',
            coins: { $sum: '$totalCoinAmount' },
          },
        },
        { $sort: { coins: -1 } },
        { $limit: Math.min(200, Math.max(1, limit)) },
      ])
      .exec();

    if (agg.length === 0) return [];

    // Hydrate room name + owner. Done as one query for cheapness; the
    // visitor count is a separate count per room so we don't blow the
    // aggregation up.
    const roomIds = agg.map((r) => r._id);
    const rooms = await this.roomModel
      .find({ _id: { $in: roomIds } })
      .select({ name: 1, ownerId: 1, numericId: 1 })
      .exec();
    const roomById = new Map(rooms.map((r) => [r._id.toString(), r]));

    // Visitor counts in parallel — N small queries, OK for top-50.
    const visitors = await Promise.all(
      roomIds.map((id) =>
        this.memberModel
          .countDocuments({
            roomId: id,
            lastSeenAt: { $gte: bounds.thisWeekStart, $lte: bounds.thisWeekEnd },
          })
          .exec(),
      ),
    );

    const out: RankingEntry[] = [];
    for (let i = 0; i < agg.length; i++) {
      const row = agg[i];
      const r = roomById.get(row._id.toString());
      if (!r) continue;
      out.push({
        rank: i + 1,
        roomId: row._id.toString(),
        roomName: r.name ?? '',
        ownerId: r.ownerId.toString(),
        coins: row.coins,
        visitors: visitors[i] ?? 0,
        level: this.resolveLevel(row.coins, visitors[i] ?? 0, config.levels).level,
      });
    }
    return out;
  }

  // ============================================================
  // Helpers
  // ============================================================

  /**
   * Aggregate a room's visitor count + coin sum across a closed window,
   * then resolve the achieved level + projected owner reward.
   *
   * Visitor count: distinct users with `RoomMember.lastSeenAt` in the
   * window. RoomMember has a unique (roomId, userId) index so simple
   * countDocuments is correct (one row per user per room).
   *
   * Coin sum: sum `GiftEvent.totalCoinAmount` for events with
   * contextType=ROOM and contextId=roomId in the window.
   */
  private async aggregateRoomMetrics(
    roomId: Types.ObjectId,
    from: Date,
    to: Date,
    levels: RoomSupportLevel[],
  ): Promise<MetricRow> {
    const [visitors, coinAgg] = await Promise.all([
      this.memberModel
        .countDocuments({
          roomId,
          lastSeenAt: { $gte: from, $lte: to },
        })
        .exec(),
      this.giftEventModel
        .aggregate<{ coins: number }>([
          {
            $match: {
              contextType: GiftContext.ROOM,
              contextId: roomId,
              createdAt: { $gte: from, $lte: to },
            },
          },
          { $group: { _id: null, coins: { $sum: '$totalCoinAmount' } } },
        ])
        .exec(),
    ]);

    const coins = coinAgg[0]?.coins ?? 0;
    return this.resolveLevel(coins, visitors, levels);
  }

  /**
   * Highest level whose `minVisitors` AND `minCoins` are both met. Returns
   * level=0 + rewardCoins=0 when no tier qualifies.
   */
  private resolveLevel(
    coins: number,
    visitors: number,
    levels: RoomSupportLevel[],
  ): MetricRow {
    let achieved: RoomSupportLevel | null = null;
    for (const l of [...levels].sort((a, b) => b.level - a.level)) {
      if (visitors >= l.minVisitors && coins >= l.minCoins) {
        achieved = l;
        break;
      }
    }
    return {
      visitors,
      coins,
      level: achieved?.level ?? 0,
      rewardCoins: achieved?.ownerCoins ?? 0,
    };
  }

  /**
   * Compute the Monday→Sunday window the in-app rules talk about, in
   * Asia/Dhaka local time, plus the next Wednesday 00:00 reward boundary.
   * All boundaries are returned as server-UTC Dates so they go through
   * Mongoose queries unchanged.
   */
  private weekBounds(now: Date): WeekBounds {
    // Step into local time by adding the offset; getUTC* now reads "local".
    const local = new Date(now.getTime() + TZ_OFFSET_MS);
    const dayOfWeek = local.getUTCDay(); // Sun=0..Sat=6
    const daysSinceMonday = (dayOfWeek + 6) % 7; // Mon=0, Tue=1, ..., Sun=6

    const localMondayMidnight = new Date(local);
    localMondayMidnight.setUTCDate(local.getUTCDate() - daysSinceMonday);
    localMondayMidnight.setUTCHours(0, 0, 0, 0);

    const thisWeekStart = new Date(localMondayMidnight.getTime() - TZ_OFFSET_MS);
    const thisWeekEnd = new Date(thisWeekStart.getTime() + ONE_WEEK_MS - 1);
    const lastWeekStart = new Date(thisWeekStart.getTime() - ONE_WEEK_MS);
    const lastWeekEnd = new Date(thisWeekStart.getTime() - 1);

    // Wednesday 00:00 local of this week.
    const thisWedStart = new Date(thisWeekStart.getTime() + 2 * ONE_DAY_MS);
    // If we're already past it, the next reward goes out next Wednesday.
    const nextRewardAt =
      thisWedStart.getTime() > now.getTime()
        ? thisWedStart
        : new Date(thisWedStart.getTime() + ONE_WEEK_MS);

    return {
      thisWeekStart,
      thisWeekEnd,
      lastWeekStart,
      lastWeekEnd,
      nextRewardAt,
    };
  }
}
