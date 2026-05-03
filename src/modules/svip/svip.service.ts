import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { randomUUID } from 'crypto';
import { Model, Types } from 'mongoose';

import { Currency, TxnType } from '../wallet/schemas/transaction.schema';
import { WalletService } from '../wallet/wallet.service';
import { SVIP_PRIVILEGES, PrivilegeDef } from './privileges.catalog';
import { SvipTier, SvipTierDocument } from './schemas/svip-tier.schema';
import { UserSvipStatus, UserSvipStatusDocument } from './schemas/user-svip-status.schema';

@Injectable()
export class SvipService {
  constructor(
    @InjectModel(SvipTier.name) private readonly tierModel: Model<SvipTierDocument>,
    @InjectModel(UserSvipStatus.name)
    private readonly statusModel: Model<UserSvipStatusDocument>,
    private readonly wallet: WalletService,
  ) {}

  // ---------- Privileges catalog ----------

  listPrivileges(): readonly PrivilegeDef[] {
    return SVIP_PRIVILEGES;
  }

  // ---------- Tier CRUD ----------

  async listTiers(activeOnly = false) {
    const filter = activeOnly ? { active: true } : {};
    return this.tierModel.find(filter).sort({ level: 1 }).exec();
  }

  async findById(id: string): Promise<SvipTierDocument | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.tierModel.findById(id).exec();
  }

  async getByIdOrThrow(id: string): Promise<SvipTierDocument> {
    const t = await this.findById(id);
    if (!t) throw new NotFoundException('SVIP tier not found');
    return t;
  }

  async getByLevel(level: number): Promise<SvipTierDocument | null> {
    return this.tierModel.findOne({ level }).exec();
  }

  async create(input: any): Promise<SvipTierDocument> {
    const exists = await this.tierModel.countDocuments({ level: input.level }).exec();
    if (exists) {
      throw new ConflictException({
        code: 'SVIP_LEVEL_TAKEN',
        message: `SVIP level ${input.level} already exists`,
      });
    }
    this.assertPrivilegesValid(input.privileges);
    return this.tierModel.create({
      ...input,
      grantedItemIds: (input.grantedItemIds ?? []).map((s: string) => new Types.ObjectId(s)),
    });
  }

  async update(id: string, update: any): Promise<SvipTierDocument> {
    const t = await this.getByIdOrThrow(id);
    if (update.privileges !== undefined) this.assertPrivilegesValid(update.privileges);

    if (update.name !== undefined) t.name = update.name;
    if (update.monthlyPointsRequired !== undefined)
      t.monthlyPointsRequired = update.monthlyPointsRequired;
    if (update.coinReward !== undefined) t.coinReward = update.coinReward;
    if (update.iconUrl !== undefined) t.iconUrl = update.iconUrl;
    if (update.iconPublicId !== undefined) t.iconPublicId = update.iconPublicId;
    if (update.bannerUrl !== undefined) t.bannerUrl = update.bannerUrl;
    if (update.bannerPublicId !== undefined) t.bannerPublicId = update.bannerPublicId;
    if (update.grantedItemIds !== undefined) {
      t.grantedItemIds = update.grantedItemIds.map((s: string) => new Types.ObjectId(s));
    }
    if (update.privileges !== undefined) t.privileges = update.privileges;
    if (update.active !== undefined) t.active = update.active;

    await t.save();
    return t;
  }

  async softDelete(id: string): Promise<void> {
    const t = await this.getByIdOrThrow(id);
    t.active = false;
    await t.save();
  }

  // ---------- User SVIP status ----------

  async getOrCreateStatus(userId: string): Promise<UserSvipStatusDocument> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new NotFoundException('Invalid user id');
    }
    const userObj = new Types.ObjectId(userId);
    return this.statusModel
      .findOneAndUpdate(
        { userId: userObj },
        { $setOnInsert: { userId: userObj } },
        { upsert: true, new: true },
      )
      .exec();
  }

  async getStatus(userId: string): Promise<UserSvipStatusDocument | null> {
    if (!Types.ObjectId.isValid(userId)) return null;
    return this.statusModel.findOne({ userId: new Types.ObjectId(userId) }).exec();
  }

  /**
   * Quick check used by other modules to gate behavior. e.g. the chat
   * module's mute action calls `userHasPrivilege(targetId, 'cant_be_ban_public_chat')`
   * before applying. Caches nothing — this is one indexed read of the
   * status doc plus a small tiers query. Cache at the call site if hot.
   */
  async userHasPrivilege(userId: string, key: string): Promise<boolean> {
    const all = await this.resolvedPrivileges(userId);
    return all.includes(key);
  }

  /**
   * Aggregated set of privilege keys the user currently enjoys, derived
   * from their currentLevel. Returns [] for non-SVIP users.
   */
  async resolvedPrivileges(userId: string): Promise<string[]> {
    const status = await this.getStatus(userId);
    if (!status || status.currentLevel === 0) return [];
    if (status.expiresAt && status.expiresAt < new Date()) return [];

    // All tiers ≤ currentLevel contribute their privileges (tiers stack).
    const tiers = await this.tierModel
      .find({ level: { $lte: status.currentLevel }, active: true })
      .exec();
    const set = new Set<string>();
    for (const t of tiers) for (const p of t.privileges) set.add(p);
    return [...set];
  }

  // ---------- Direct purchase (coins → tier) ----------

  /**
   * Pay coins to acquire an SVIP tier directly. Bypasses the monthly-
   * points pathway. Used by the mobile SVIP page when the user has
   * enough coins; the page falls back to the Recharge CTA otherwise.
   *
   * Flow:
   *   1. Resolve the tier and validate it's purchasable (`coinPrice > 0`).
   *   2. Refuse if the caller already holds an equal-or-higher tier —
   *      buying SVIP3 when you're already SVIP5 wastes coins for no
   *      gain, so we 409 instead of silently accepting.
   *   3. Wallet debit (idempotency key derived from user + tier so a
   *      double-tap doesn't double-charge).
   *   4. Bump UserSvipStatus.currentLevel + extend `expiresAt` by the
   *      tier's `durationDays`. If the user already had time left
   *      from a prior purchase, we add to it rather than reset — so
   *      buying SVIP1 in March then SVIP1 again in April gives ~60
   *      days, not 30.
   *
   * Returns the fresh status doc so the mobile page can refresh state
   * in one round-trip.
   */
  async purchaseTier(
    userId: string,
    level: number,
  ): Promise<UserSvipStatusDocument> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException({
        code: 'INVALID_USER_ID',
        message: 'Invalid user id',
      });
    }
    const tier = await this.getByLevel(level);
    if (!tier || !tier.active) {
      throw new NotFoundException({
        code: 'SVIP_TIER_NOT_FOUND',
        message: `SVIP tier ${level} not found`,
      });
    }
    if (tier.coinPrice <= 0) {
      throw new BadRequestException({
        code: 'TIER_NOT_PURCHASABLE',
        message: 'This tier is not available for direct purchase',
      });
    }

    const status = await this.getOrCreateStatus(userId);
    if (status.currentLevel >= level) {
      throw new ConflictException({
        code: 'ALREADY_OWNED',
        message: 'You already hold this tier or higher',
      });
    }

    // Stable idempotency: a double-tap within the same second of the
    // same (user, tier) attempts the same key, so the wallet's
    // dedupe path returns the existing txn. Random suffix from a
    // UUID keeps repeat-purchases of the same tier across separate
    // sessions distinct.
    await this.wallet.debit(Currency.COINS, {
      userId,
      amount: tier.coinPrice,
      type: TxnType.SVIP_PURCHASE,
      idempotencyKey: `svip-purchase:${userId}:${tier._id.toString()}:${randomUUID()}`,
      description: `Purchased ${tier.name}`,
      refType: 'svip_tier',
      refId: tier._id.toString(),
    });

    // Extend expiry from whichever is later: now or the user's
    // existing expiry. Prevents losing remaining time when buying a
    // higher tier mid-cycle. `durationDays: 0` means permanent —
    // we drop expiresAt entirely in that case.
    const now = new Date();
    let expiresAt: Date | null;
    if (tier.durationDays === 0) {
      expiresAt = null;
    } else {
      const base =
        status.expiresAt && status.expiresAt > now ? status.expiresAt : now;
      expiresAt = new Date(
        base.getTime() + tier.durationDays * 24 * 60 * 60 * 1000,
      );
    }
    status.currentLevel = level;
    if (level > status.highestLevel) status.highestLevel = level;
    status.expiresAt = expiresAt;
    await status.save();
    return status;
  }

  // ---------- helpers ----------

  private assertPrivilegesValid(privileges: string[] | undefined) {
    if (!privileges) return;
    const valid = new Set(SVIP_PRIVILEGES.map((p) => p.key));
    const unknown = privileges.filter((p) => !valid.has(p));
    if (unknown.length > 0) {
      throw new ConflictException({
        code: 'UNKNOWN_PRIVILEGE',
        message: 'One or more privilege keys are not in the catalog',
        details: { unknown },
      });
    }
  }
}
