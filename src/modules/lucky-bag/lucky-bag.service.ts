import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { randomUUID } from 'crypto';

import { RealtimeService } from '../realtime/realtime.service';
import { RealtimeEventType } from '../realtime/realtime.types';
import { Room, RoomDocument } from '../rooms/schemas/room.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { Currency, TxnType } from '../wallet/schemas/transaction.schema';
import { WalletService } from '../wallet/wallet.service';
import {
  LuckyBagConfig,
  LuckyBagConfigDocument,
  LuckyBagTier,
} from './schemas/lucky-bag-config.schema';
import {
  LuckyBag,
  LuckyBagDistributionMode,
  LuckyBagDocument,
  LuckyBagStatus,
} from './schemas/lucky-bag.schema';

/** Minimum total coin amount per bag — prevents 0-coin spam. */
const MIN_TOTAL_COINS = 1000;
const MAX_TOTAL_COINS = 100_000_000;
/** Slot count bounds — matches the in-app composer presets (10..100). */
const MIN_SLOTS = 1;
const MAX_SLOTS = 100;
/** Fallback when config doesn't exist yet — overridden per-create by
 *  `config.openCountdownSeconds` and `config.claimWindowSeconds`. */
const DEFAULT_OPEN_COUNTDOWN_SECONDS = 30;
const DEFAULT_CLAIM_WINDOW_SECONDS = 30;

const SINGLETON_KEY = 'singleton';

/**
 * Default tiers — taken verbatim from `docs/test.txt`. The fixed-tier
 * algorithm uses these as the user-pool split (commission, when applied,
 * is taken off the top before this table is consulted).
 *
 * Each row's `percentages` MUST sum to 1.0 within ε. The lazy-upsert
 * seeds them on first read; admins can edit via PATCH afterwards.
 */
const DEFAULT_TIERS: LuckyBagTier[] = [
  {
    slotCount: 5,
    percentages: [0.35, 0.25, 0.2, 0.15, 0.05],
  },
  {
    slotCount: 10,
    percentages: [0.25, 0.18, 0.15, 0.12, 0.1, 0.08, 0.05, 0.04, 0.02, 0.01],
  },
  {
    slotCount: 20,
    percentages: [
      0.18, 0.14, 0.11, 0.09, 0.08, 0.07, 0.06, 0.05, 0.04, 0.03, 0.03, 0.02,
      0.02, 0.02, 0.02, 0.01, 0.01, 0.01, 0.005, 0.005,
    ],
  },
  {
    slotCount: 30,
    percentages: [
      0.15, 0.12, 0.1, 0.08, 0.07, 0.06, 0.05, 0.04, 0.04, 0.03, 0.03, 0.02,
      0.02, 0.02, 0.02, 0.015, 0.015, 0.015, 0.015, 0.01, 0.01, 0.01, 0.01,
      0.005, 0.005, 0.005, 0.005, 0.005, 0.005, 0.005,
    ],
  },
  {
    slotCount: 50,
    percentages: [
      0.12, 0.1, 0.08, 0.07, 0.06, 0.05, 0.04, 0.04, 0.03, 0.03, 0.02, 0.02,
      0.02, 0.02, 0.02, 0.015, 0.015, 0.015, 0.015, 0.015, 0.01, 0.01, 0.01,
      0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.005, 0.005, 0.005, 0.005,
      0.005, 0.005, 0.005, 0.005, 0.005, 0.005, 0.0025, 0.0025, 0.0025, 0.0025,
      0.0025, 0.0025, 0.0025, 0.0025, 0.0025, 0.0025,
    ],
  },
];

interface CreateLuckyBagInput {
  senderId: string;
  /** Required for v1 — bags are room-scoped. Personal/profile bags are Phase 2. */
  roomId: string;
  totalCoins: number;
  slotCount: number;
  /**
   * Optional — defaults to RANDOM. Sender picks from the composer's
   * "Distribution mode" toggle.
   */
  distributionMode?: LuckyBagDistributionMode;
}

@Injectable()
export class LuckyBagService {
  private readonly log = new Logger('LuckyBagService');

  constructor(
    @InjectModel(LuckyBag.name)
    private readonly bagModel: Model<LuckyBagDocument>,
    @InjectModel(LuckyBagConfig.name)
    private readonly configModel: Model<LuckyBagConfigDocument>,
    @InjectModel(Room.name) private readonly roomModel: Model<RoomDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly wallet: WalletService,
    private readonly realtime: RealtimeService,
  ) {}

  // ============================================================
  // Platform config
  // ============================================================

  /**
   * Lazy-upsert config singleton. First read on a fresh deployment
   * seeds defaults straight from `docs/test.txt` so the composer has
   * useful presets before an admin even visits the panel.
   */
  async getConfig(): Promise<LuckyBagConfigDocument> {
    return this.configModel
      .findOneAndUpdate(
        { key: SINGLETON_KEY },
        {
          $setOnInsert: {
            key: SINGLETON_KEY,
            enabled: true,
            commissionRate: 0.25,
            applyCommissionByDefault: true,
            coinPresets: [60000, 150000, 210000, 300000, 600000],
            tiers: DEFAULT_TIERS,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();
  }

  async updateConfig(update: {
    enabled?: boolean;
    commissionRate?: number;
    applyCommissionByDefault?: boolean;
    coinPresets?: number[];
    tiers?: LuckyBagTier[];
    composerShowDistributionMode?: boolean;
    composerDefaultDistributionMode?: LuckyBagDistributionMode;
    openCountdownSeconds?: number;
    claimWindowSeconds?: number;
    maxConcurrentPerRoom?: number;
  }): Promise<LuckyBagConfigDocument> {
    if (update.commissionRate !== undefined) {
      if (update.commissionRate < 0 || update.commissionRate > 1) {
        throw new BadRequestException({
          code: 'INVALID_COMMISSION',
          message: 'commissionRate must be between 0 and 1',
        });
      }
    }
    if (update.tiers !== undefined) {
      // Validate every tier sums to 1.0 and the percentages array
      // matches the slotCount. Reject the whole patch if anything is
      // off so admin gets a clear single error.
      for (const t of update.tiers) {
        if (!Number.isInteger(t.slotCount) || t.slotCount < 1) {
          throw new BadRequestException({
            code: 'INVALID_TIER',
            message: `Tier slotCount must be a positive integer (got ${t.slotCount})`,
          });
        }
        if (t.percentages.length !== t.slotCount) {
          throw new BadRequestException({
            code: 'INVALID_TIER',
            message: `Tier ${t.slotCount}: percentages length (${t.percentages.length}) must equal slotCount`,
          });
        }
        const sum = t.percentages.reduce((s, p) => s + p, 0);
        if (Math.abs(sum - 1) > 0.001) {
          throw new BadRequestException({
            code: 'INVALID_TIER',
            message: `Tier ${t.slotCount}: percentages must sum to 1.0 (got ${sum.toFixed(4)})`,
          });
        }
      }
    }
    if (update.coinPresets !== undefined) {
      if (!update.coinPresets.every((c) => Number.isInteger(c) && c > 0)) {
        throw new BadRequestException({
          code: 'INVALID_PRESETS',
          message: 'coinPresets must be positive integers',
        });
      }
    }

    const set: Record<string, unknown> = {};
    if (update.enabled !== undefined) set.enabled = update.enabled;
    if (update.commissionRate !== undefined) set.commissionRate = update.commissionRate;
    if (update.applyCommissionByDefault !== undefined) {
      set.applyCommissionByDefault = update.applyCommissionByDefault;
    }
    if (update.coinPresets !== undefined) set.coinPresets = update.coinPresets;
    if (update.tiers !== undefined) {
      // Sort by slotCount ascending so the admin UI gets a stable order.
      set.tiers = [...update.tiers].sort((a, b) => a.slotCount - b.slotCount);
    }
    if (update.composerShowDistributionMode !== undefined) {
      set.composerShowDistributionMode = update.composerShowDistributionMode;
    }
    if (update.composerDefaultDistributionMode !== undefined) {
      set.composerDefaultDistributionMode =
        update.composerDefaultDistributionMode;
    }
    if (update.openCountdownSeconds !== undefined) {
      set.openCountdownSeconds = update.openCountdownSeconds;
    }
    if (update.claimWindowSeconds !== undefined) {
      set.claimWindowSeconds = update.claimWindowSeconds;
    }
    if (update.maxConcurrentPerRoom !== undefined) {
      set.maxConcurrentPerRoom = update.maxConcurrentPerRoom;
    }

    return this.configModel
      .findOneAndUpdate(
        { key: SINGLETON_KEY },
        { $set: set, $setOnInsert: { key: SINGLETON_KEY } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();
  }

  // ============================================================
  // Read
  // ============================================================

  async getByIdOrThrow(id: string): Promise<LuckyBagDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException({ code: 'BAG_NOT_FOUND', message: 'Lucky bag not found' });
    }
    const bag = await this.bagModel.findById(id).exec();
    if (!bag) {
      throw new NotFoundException({ code: 'BAG_NOT_FOUND', message: 'Lucky bag not found' });
    }
    return bag;
  }

  /**
   * Detail view used by the recipients-list page. Hydrates sender +
   * each claim's user (display name / avatar / numericId) so the page
   * can render the roster without N follow-up requests.
   */
  async getDetails(id: string) {
    const bag = await this.getByIdOrThrow(id);
    const populated = await this.bagModel
      .findById(bag._id)
      .populate('senderId', 'username displayName avatarUrl numericId')
      .populate('claims.userId', 'username displayName avatarUrl numericId')
      .exec();
    return populated ?? bag;
  }

  /**
   * Bags this user sent. Lightweight projection — caller's history view
   * cares about totals and timestamps, not every claim row, so we
   * exclude `slotAmounts` + `claims` from the wire payload via projection.
   */
  async listSentBy(userId: string, opts: { page?: number; limit?: number } = {}) {
    if (!Types.ObjectId.isValid(userId)) {
      return { items: [], page: 1, limit: 30, total: 0 };
    }
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(100, Math.max(1, opts.limit ?? 30));
    const skip = (page - 1) * limit;
    const filter = { senderId: new Types.ObjectId(userId) };
    const [items, total] = await Promise.all([
      this.bagModel
        .find(filter)
        .select({ slotAmounts: 0 })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.bagModel.countDocuments(filter).exec(),
    ]);
    return { items, page, limit, total };
  }

  /**
   * Bags where this user has a claim. Mongo can't `$elemMatch` on a
   * subarray and project just the matching element + parent fields
   * cleanly here, so we project the whole claims array and let the
   * mobile page filter to the user's own claim row.
   */
  async listReceivedBy(userId: string, opts: { page?: number; limit?: number } = {}) {
    if (!Types.ObjectId.isValid(userId)) {
      return { items: [], page: 1, limit: 30, total: 0 };
    }
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(100, Math.max(1, opts.limit ?? 30));
    const skip = (page - 1) * limit;
    const filter = { 'claims.userId': new Types.ObjectId(userId) };
    const [items, total] = await Promise.all([
      this.bagModel
        .find(filter)
        .select({ slotAmounts: 0 })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('senderId', 'username displayName avatarUrl numericId')
        .exec(),
      this.bagModel.countDocuments(filter).exec(),
    ]);
    return { items, page, limit, total };
  }

  /** Active bags in a room — used when a user joins, to render any
   *  in-flight cards they might have missed. Filters by both `expiresAt`
   *  AND an effective expiry of `availableAt + claimWindowSeconds`, so
   *  old bags created with a long lifetime (24h before the timing
   *  config landed) drop out of the active list once their actual
   *  claim window has passed. Sender is populated so late joiners see
   *  the actual avatar + name on the floating card / claim modal,
   *  not a generic "Someone" fallback. */
  async listActiveInRoom(roomId: string) {
    if (!Types.ObjectId.isValid(roomId)) return [];
    const config = await this.getConfig();
    const claimWindow = config.claimWindowSeconds ?? 30;
    const now = new Date();
    const effectiveAvailableCutoff = new Date(
      now.getTime() - claimWindow * 1000,
    );
    return this.bagModel
      .find({
        roomId: new Types.ObjectId(roomId),
        status: LuckyBagStatus.PENDING,
        expiresAt: { $gt: now },
        availableAt: { $gt: effectiveAvailableCutoff },
      })
      .sort({ createdAt: -1 })
      .limit(20)
      .populate('senderId', 'username displayName avatarUrl numericId')
      .exec();
  }

  // ============================================================
  // Create
  // ============================================================

  async create(input: CreateLuckyBagInput): Promise<LuckyBagDocument> {
    if (!Types.ObjectId.isValid(input.senderId)) {
      throw new BadRequestException({ code: 'INVALID_USER_ID', message: 'Invalid user' });
    }
    if (!Types.ObjectId.isValid(input.roomId)) {
      throw new BadRequestException({ code: 'INVALID_ROOM_ID', message: 'Invalid room' });
    }
    if (input.totalCoins < MIN_TOTAL_COINS || input.totalCoins > MAX_TOTAL_COINS) {
      throw new BadRequestException({
        code: 'INVALID_AMOUNT',
        message: `Total coins must be between ${MIN_TOTAL_COINS} and ${MAX_TOTAL_COINS}`,
      });
    }
    if (input.slotCount < MIN_SLOTS || input.slotCount > MAX_SLOTS) {
      throw new BadRequestException({
        code: 'INVALID_SLOTS',
        message: `Slot count must be between ${MIN_SLOTS} and ${MAX_SLOTS}`,
      });
    }
    if (input.slotCount > input.totalCoins) {
      // Otherwise some slots would have to be 0.
      throw new BadRequestException({
        code: 'TOO_MANY_SLOTS',
        message: 'Need at least one coin per slot',
      });
    }

    // Resolve platform config — drives commission + tier choice +
    // (when in fixed-tier mode) which slotCounts are allowed.
    const config = await this.getConfig();
    if (!config.enabled) {
      throw new ForbiddenException({
        code: 'LUCKY_BAG_DISABLED',
        message: 'Lucky Bag is currently disabled.',
      });
    }
    // Concurrent-bag cap. Default 1 — only one active bag per room at
    // a time, mirrors the in-app expectation that you wait for the
    // current bag to finish before dropping another. Admin can raise
    // this in `/lucky-bag` config if multi-drop UX ever lands. The
    // effective-expiry filter prevents stuck old bags (created with a
    // long lifetime) from blocking new drops past their claim window.
    const maxConcurrent = config.maxConcurrentPerRoom ?? 1;
    const claimWindow = config.claimWindowSeconds ?? 30;
    const nowForCap = new Date();
    const activeCount = await this.bagModel
      .countDocuments({
        roomId: new Types.ObjectId(input.roomId),
        status: LuckyBagStatus.PENDING,
        expiresAt: { $gt: nowForCap },
        availableAt: {
          $gt: new Date(nowForCap.getTime() - claimWindow * 1000),
        },
      })
      .exec();
    if (activeCount >= maxConcurrent) {
      throw new BadRequestException({
        code: 'TOO_MANY_ACTIVE',
        message:
          maxConcurrent === 1
            ? 'A Lucky Bag is already active in this room. Wait for it to finish before dropping another.'
            : `At most ${maxConcurrent} Lucky Bags can be active in this room at once.`,
      });
    }

    // Distribution-mode policy. When the admin has hidden the picker,
    // the server forces `composerDefaultDistributionMode` regardless of
    // what the client sent — keeps mobile honest if it tries to override
    // a hidden picker. When the picker IS visible, the user's choice
    // (or the default if they didn't send one) is used.
    const mode = config.composerShowDistributionMode
      ? (input.distributionMode ??
          config.composerDefaultDistributionMode ??
          LuckyBagDistributionMode.RANDOM)
      : (config.composerDefaultDistributionMode ??
          LuckyBagDistributionMode.RANDOM);
    if (mode === LuckyBagDistributionMode.FIXED_TIER) {
      const tier = config.tiers.find((t) => t.slotCount === input.slotCount);
      if (!tier) {
        throw new BadRequestException({
          code: 'NO_MATCHING_TIER',
          message: `Fixed-tier mode requires a configured tier for slotCount=${input.slotCount}`,
        });
      }
    }

    // 1. Debit the sender first. If the wallet rejects (insufficient /
    //    frozen) we never persist a bag.
    const debitKey = `lucky-bag:create:${input.senderId}:${randomUUID()}`;
    await this.wallet.debit(Currency.COINS, {
      userId: input.senderId,
      amount: input.totalCoins,
      type: TxnType.LUCKY_BAG_SEND,
      description: `Lucky Bag in room ${input.roomId}`,
      idempotencyKey: debitKey,
      refType: 'lucky_bag',
      performedBy: input.senderId,
    });

    // 2. Compute commission + per-slot amounts. Both modes split the
    //    user pool (totalCoins − commission) so the platform's cut is
    //    consistent across modes; only the WAY the pool is sliced changes.
    const applyCommission = config.applyCommissionByDefault;
    const commissionAmount = applyCommission
      ? Math.floor(input.totalCoins * config.commissionRate)
      : 0;
    const userPool = input.totalCoins - commissionAmount;
    const slotAmounts =
      mode === LuckyBagDistributionMode.FIXED_TIER
        ? this.distributeFixedTier(
            userPool,
            input.slotCount,
            config.tiers.find((t) => t.slotCount === input.slotCount)!.percentages,
          )
        : this.distributeRandom(userPool, input.slotCount);

    // 3. Persist the bag. The countdown + claim window come from the
    //    admin config so operators can tune the in-app feel without a
    //    redeploy.
    const openCountdownSeconds =
      config.openCountdownSeconds ?? DEFAULT_OPEN_COUNTDOWN_SECONDS;
    const claimWindowSeconds =
      config.claimWindowSeconds ?? DEFAULT_CLAIM_WINDOW_SECONDS;
    const now = new Date();
    const availableAt = new Date(now.getTime() + openCountdownSeconds * 1000);
    const expiresAt = new Date(
      availableAt.getTime() + claimWindowSeconds * 1000,
    );
    const bag = await this.bagModel.create({
      senderId: new Types.ObjectId(input.senderId),
      roomId: new Types.ObjectId(input.roomId),
      totalCoins: input.totalCoins,
      slotCount: input.slotCount,
      slotAmounts,
      nextSlotIndex: 0,
      claims: [],
      availableAt,
      expiresAt,
      status: LuckyBagStatus.PENDING,
      distributionMode: mode,
      applyCommission,
      commissionAmount,
      debitIdempotencyKey: debitKey,
    });

    // 4. Broadcast to the room so every member's client renders the
    //    floating card. We hydrate the sender so the card shows their
    //    avatar / display name without a follow-up request.
    const populated = await this.bagModel
      .findById(bag._id)
      .populate('senderId', 'username displayName avatarUrl numericId')
      .exec();
    void this.realtime.emitToRoom(
      input.roomId,
      RealtimeEventType.ROOM_LUCKY_BAG_SENT,
      { bag: populated?.toJSON() ?? bag.toJSON() },
    );

    // 5. Global banner so users in OTHER rooms (or just browsing) see
    //    the drop and can hop in. Compact payload — the banner just
    //    needs sender + room name to render; full bag fetched on tap.
    const [room, sender] = await Promise.all([
      this.roomModel
        .findById(bag.roomId)
        .select({ name: 1, numericId: 1 })
        .exec(),
      this.userModel
        .findById(bag.senderId)
        .select({ displayName: 1, username: 1, avatarUrl: 1 })
        .exec(),
    ]);
    void this.realtime.emitGlobal(
      RealtimeEventType.GLOBAL_LUCKY_BAG_BANNER,
      {
        bagId: bag._id.toString(),
        roomId: bag.roomId?.toString() ?? null,
        roomName: room?.name ?? '',
        senderId: bag.senderId.toString(),
        senderName:
          sender?.displayName?.trim().length
            ? sender!.displayName
            : (sender?.username ?? 'Someone'),
        senderAvatarUrl: sender?.avatarUrl ?? '',
        totalCoins: bag.totalCoins,
        slotCount: bag.slotCount,
      },
    );

    return bag;
  }

  // ============================================================
  // Claim
  // ============================================================

  /**
   * Atomically grab the next unclaimed slot and credit the user's
   * wallet. Concurrent claims from N users always settle to N distinct
   * slot grabs because `nextSlotIndex` is `$inc`-ed in the same op that
   * pushes the claim — Mongo serialises the writes per-document.
   */
  async claim(
    bagId: string,
    userId: string,
  ): Promise<{ amount: number; slotIndex: number; bag: LuckyBagDocument }> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException({ code: 'INVALID_USER_ID', message: 'Invalid user' });
    }

    const bag = await this.getByIdOrThrow(bagId);
    const userOid = new Types.ObjectId(userId);
    const now = new Date();

    if (bag.status !== LuckyBagStatus.PENDING) {
      throw new ConflictException({
        code: 'BAG_NOT_PENDING',
        message: 'This Lucky Bag is no longer claimable.',
      });
    }
    if (now < bag.availableAt) {
      const remaining = Math.ceil(
        (bag.availableAt.getTime() - now.getTime()) / 1000,
      );
      throw new ForbiddenException({
        code: 'BAG_NOT_READY',
        message: `Available in ${remaining}s`,
        details: { remainingSeconds: remaining },
      });
    }
    if (now > bag.expiresAt) {
      throw new ConflictException({ code: 'BAG_EXPIRED', message: 'This bag has expired.' });
    }
    // Sender can't claim from their own bag.
    if (bag.senderId.equals(userOid)) {
      throw new ForbiddenException({
        code: 'SENDER_CANNOT_CLAIM',
        message: 'You can\'t claim your own Lucky Bag.',
      });
    }
    // Already claimed?
    if (bag.claims.some((c) => c.userId.equals(userOid))) {
      throw new ConflictException({
        code: 'ALREADY_CLAIMED',
        message: 'You already claimed from this Lucky Bag.',
      });
    }

    // Conditional update: only succeed if this user isn't already in
    // claims AND there's still a slot left. The `$inc` on nextSlotIndex
    // is what makes concurrent claims hand out distinct slotIndexes.
    const updated = await this.bagModel
      .findOneAndUpdate(
        {
          _id: bag._id,
          status: LuckyBagStatus.PENDING,
          'claims.userId': { $ne: userOid },
          $expr: { $lt: ['$nextSlotIndex', '$slotCount'] },
        },
        [
          // Aggregation-pipeline update so we can read the soon-to-be
          // slotIndex back into the new claim's amount via $arrayElemAt.
          {
            $set: {
              nextSlotIndex: { $add: ['$nextSlotIndex', 1] },
              claims: {
                $concatArrays: [
                  '$claims',
                  [
                    {
                      userId: userOid,
                      slotIndex: '$nextSlotIndex',
                      amount: {
                        $arrayElemAt: ['$slotAmounts', '$nextSlotIndex'],
                      },
                      claimedAt: now,
                    },
                  ],
                ],
              },
              status: {
                $cond: [
                  { $gte: [{ $add: ['$nextSlotIndex', 1] }, '$slotCount'] },
                  LuckyBagStatus.DEPLOYED,
                  LuckyBagStatus.PENDING,
                ],
              },
            },
          },
        ],
        { new: true },
      )
      .exec();

    if (!updated) {
      // Either depleted between our read + write, or the user slipped a
      // double-claim through. Re-read to give a precise error code.
      const fresh = await this.bagModel.findById(bag._id).exec();
      if (!fresh) {
        throw new NotFoundException({
          code: 'BAG_NOT_FOUND',
          message: 'Lucky bag not found',
        });
      }
      if (fresh.claims.some((c) => c.userId.equals(userOid))) {
        throw new ConflictException({
          code: 'ALREADY_CLAIMED',
          message: 'You already claimed from this Lucky Bag.',
        });
      }
      if (fresh.nextSlotIndex >= fresh.slotCount) {
        throw new ConflictException({
          code: 'BAG_DEPLETED',
          message: 'All slots have been claimed.',
        });
      }
      throw new ConflictException({
        code: 'BAG_CLAIM_FAILED',
        message: 'Could not claim — please try again.',
      });
    }

    // Find the claim we just appended so we can echo the amount back
    // and use the slotIndex for the realtime payload.
    const myClaim = updated.claims.find((c) => c.userId.equals(userOid));
    if (!myClaim) {
      // Defensive — shouldn't be reachable since the update succeeded.
      throw new ConflictException({
        code: 'BAG_CLAIM_FAILED',
        message: 'Could not claim — please try again.',
      });
    }

    // Credit the recipient's wallet. Idempotency on (bagId, userId) so
    // a retry of the same claim pair never double-credits.
    await this.wallet.credit(Currency.COINS, {
      userId,
      amount: myClaim.amount,
      type: TxnType.LUCKY_BAG_RECEIVE,
      description: `Lucky Bag claim`,
      idempotencyKey: `lucky-bag:claim:${updated._id.toString()}:${userId}`,
      refType: 'lucky_bag',
      refId: updated._id.toString(),
      performedBy: userId,
    });

    // Broadcast the claim so every member can tick "X/N taken" + (if
    // depleted) retire the floating card. We send the SLOTS counters
    // rather than the full bag — tighter payload.
    if (updated.roomId) {
      void this.realtime.emitToRoom(
        updated.roomId.toString(),
        RealtimeEventType.ROOM_LUCKY_BAG_CLAIMED,
        {
          bagId: updated._id.toString(),
          claimerId: userId,
          slotIndex: myClaim.slotIndex,
          amount: myClaim.amount,
          slotsTaken: updated.claims.length,
          slotCount: updated.slotCount,
          status: updated.status,
        },
      );
    }

    return {
      amount: myClaim.amount,
      slotIndex: myClaim.slotIndex,
      bag: updated,
    };
  }

  // ============================================================
  // Cancel — sender drops a still-pending bag
  // ============================================================

  /**
   * Sender-initiated cancellation. Marks the bag EXPIRED, refunds the
   * unclaimed remainder back to the sender's wallet, and emits a
   * realtime event so every client drops the floating card.
   *
   * This is the escape hatch for stuck bags created with an older
   * lifetime config (before `claimWindowSeconds` landed) — the sender
   * can clear them and drop a fresh bag. Anyone other than the sender
   * gets `NOT_BAG_OWNER`.
   */
  async cancel(bagId: string, userId: string) {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException({
        code: 'INVALID_USER_ID',
        message: 'Invalid user',
      });
    }
    const userOid = new Types.ObjectId(userId);
    const bag = await this.getByIdOrThrow(bagId);

    if (!bag.senderId.equals(userOid)) {
      throw new ForbiddenException({
        code: 'NOT_BAG_OWNER',
        message: 'Only the sender can cancel this Lucky Bag.',
      });
    }
    // Already-EXPIRED bags can't be cancelled twice. PENDING bags are
    // the normal cancel path; DEPLOYED bags (all slots already claimed)
    // are also accepted so the sender can clear a stuck floating card —
    // refund will just be 0 since there's nothing left.
    if (
      bag.status !== LuckyBagStatus.PENDING &&
      bag.status !== LuckyBagStatus.DEPLOYED
    ) {
      throw new ConflictException({
        code: 'BAG_ALREADY_EXPIRED',
        message: 'This Lucky Bag has already been cancelled.',
      });
    }

    // Compute refund: unclaimed slots × their preset amounts. Claimed
    // slots are not refunded — recipients keep their share.
    const claimedAmount = bag.claims.reduce((s, c) => s + c.amount, 0);
    const refundAmount = Math.max(0, bag.totalCoins - claimedAmount);

    // Atomic flip from either PENDING or DEPLOYED → EXPIRED. The $in
    // filter avoids races with last-claim-arrives-during-cancel: if the
    // bag has already been moved to EXPIRED by a parallel cancel, the
    // query won't match and we throw below.
    const updated = await this.bagModel
      .findOneAndUpdate(
        {
          _id: bag._id,
          status: { $in: [LuckyBagStatus.PENDING, LuckyBagStatus.DEPLOYED] },
        },
        { $set: { status: LuckyBagStatus.EXPIRED, expiresAt: new Date() } },
        { new: true },
      )
      .exec();
    if (!updated) {
      throw new ConflictException({
        code: 'BAG_ALREADY_EXPIRED',
        message: 'Bag was already cancelled or expired.',
      });
    }

    // Refund the sender — only if there's something left to give back.
    // Idempotent on (bagId, sender) so a retry of the same cancel never
    // double-refunds.
    if (refundAmount > 0) {
      try {
        await this.wallet.credit(Currency.COINS, {
          userId,
          amount: refundAmount,
          type: TxnType.LUCKY_BAG_REFUND,
          description: `Lucky Bag refund (cancelled)`,
          idempotencyKey: `lucky-bag:cancel:${updated._id.toString()}:${userId}`,
          refType: 'lucky_bag',
          refId: updated._id.toString(),
          performedBy: userId,
        });
      } catch (err: any) {
        this.log.error(
          `Refund failed for cancelled bag ${updated._id}: ${err?.message ?? err}`,
        );
      }
    }

    // Broadcast — every client treats slotsTaken === slotCount as
    // "remove the floating card", so we set it to slotCount to drop the
    // card on cancel. We also include `cancelled: true` so future UI
    // can surface a different toast if desired.
    if (updated.roomId) {
      void this.realtime.emitToRoom(
        updated.roomId.toString(),
        RealtimeEventType.ROOM_LUCKY_BAG_CLAIMED,
        {
          bagId: updated._id.toString(),
          slotsTaken: updated.slotCount,
          slotCount: updated.slotCount,
          status: updated.status,
          cancelled: true,
          refundAmount,
        },
      );
    }

    return { refundAmount };
  }

  // ============================================================
  // Distribution algorithm
  // ============================================================

  /**
   * Random "leftover" distribution: each draw gets a random portion
   * between 1 and 2× the average remaining-per-slot, with the final
   * slot soaking up whatever's left so the total is always exact. The
   * resulting amounts feel "lucky" — a couple lucky big wins, a long
   * tail of small ones — without any slot ever being zero.
   */
  private distributeRandom(total: number, slots: number): number[] {
    const out: number[] = new Array(slots).fill(0);
    let remaining = total;
    let remainingSlots = slots;
    for (let i = 0; i < slots - 1; i++) {
      // Reserve 1 coin for each remaining slot so nothing ends up zero.
      const reserved = remainingSlots - 1;
      const max = Math.max(1, Math.floor(((remaining - reserved) * 2) / remainingSlots));
      const amount = Math.max(1, Math.floor(Math.random() * max) + 1);
      out[i] = amount;
      remaining -= amount;
      remainingSlots -= 1;
    }
    // Last slot gets the leftover — keeps the running total exact.
    out[slots - 1] = Math.max(1, remaining);
    // Shuffle so the lucky biggest amounts aren't always at the front.
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  /**
   * Fixed-tier distribution from `docs/test.txt`. Slot 1 gets the
   * largest cut, slot N the smallest. Floor each percentage × pool to
   * avoid totals exceeding the pool; any rounding leftover (always
   * non-negative, at most slotCount−1 coins) flows back into slot 1
   * so the user-pool sum is always exact and the biggest payout still
   * "feels" the biggest. Output order matches the percentages array
   * (no shuffle — slot rank is part of the design).
   */
  private distributeFixedTier(
    total: number,
    slots: number,
    percentages: number[],
  ): number[] {
    if (percentages.length !== slots) {
      // Defensive — caller should have validated already.
      throw new BadRequestException({
        code: 'TIER_LENGTH_MISMATCH',
        message: 'percentages length must equal slot count',
      });
    }
    const out: number[] = percentages.map((p) =>
      Math.max(0, Math.floor(total * p)),
    );
    const sum = out.reduce((s, v) => s + v, 0);
    const leftover = total - sum;
    if (leftover > 0) out[0] += leftover;
    // Defensive: never let a slot end up at 0 (the random algorithm
    // never does either). If percentages would round to 0 for the
    // smallest slots, top them up by stealing from slot 0.
    for (let i = 1; i < out.length; i++) {
      if (out[i] === 0 && out[0] > 1) {
        out[i] = 1;
        out[0] -= 1;
      }
    }
    return out;
  }
}
