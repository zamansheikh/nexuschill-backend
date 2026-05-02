import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
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
  LuckyBag,
  LuckyBagDocument,
  LuckyBagStatus,
} from './schemas/lucky-bag.schema';

/** Minimum total coin amount per bag — prevents 0-coin spam. */
const MIN_TOTAL_COINS = 1000;
const MAX_TOTAL_COINS = 100_000_000;
/** Slot count bounds — matches the in-app composer presets (10..100). */
const MIN_SLOTS = 1;
const MAX_SLOTS = 100;
/** Seconds the recipients have to wait before claiming. */
const COUNTDOWN_SECONDS = 12;
/** Total bag lifetime — after this, unclaimed slots refund to sender. */
const LIFETIME_HOURS = 24;

interface CreateLuckyBagInput {
  senderId: string;
  /** Required for v1 — bags are room-scoped. Personal/profile bags are Phase 2. */
  roomId: string;
  totalCoins: number;
  slotCount: number;
}

@Injectable()
export class LuckyBagService {
  constructor(
    @InjectModel(LuckyBag.name)
    private readonly bagModel: Model<LuckyBagDocument>,
    @InjectModel(Room.name) private readonly roomModel: Model<RoomDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly wallet: WalletService,
    private readonly realtime: RealtimeService,
  ) {}

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
   *  in-flight cards they might have missed. */
  async listActiveInRoom(roomId: string) {
    if (!Types.ObjectId.isValid(roomId)) return [];
    return this.bagModel
      .find({
        roomId: new Types.ObjectId(roomId),
        status: LuckyBagStatus.PENDING,
        expiresAt: { $gt: new Date() },
      })
      .sort({ createdAt: -1 })
      .limit(20)
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

    // 2. Pre-compute random per-slot amounts that sum to totalCoins.
    const slotAmounts = this.distribute(input.totalCoins, input.slotCount);

    // 3. Persist the bag.
    const now = new Date();
    const bag = await this.bagModel.create({
      senderId: new Types.ObjectId(input.senderId),
      roomId: new Types.ObjectId(input.roomId),
      totalCoins: input.totalCoins,
      slotCount: input.slotCount,
      slotAmounts,
      nextSlotIndex: 0,
      claims: [],
      availableAt: new Date(now.getTime() + COUNTDOWN_SECONDS * 1000),
      expiresAt: new Date(now.getTime() + LIFETIME_HOURS * 3600 * 1000),
      status: LuckyBagStatus.PENDING,
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
  // Distribution algorithm
  // ============================================================

  /**
   * Random "leftover" distribution: each draw gets a random portion
   * between 1 and 2× the average remaining-per-slot, with the final
   * slot soaking up whatever's left so the total is always exact. The
   * resulting amounts feel "lucky" — a couple lucky big wins, a long
   * tail of small ones — without any slot ever being zero.
   */
  private distribute(total: number, slots: number): number[] {
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
}
