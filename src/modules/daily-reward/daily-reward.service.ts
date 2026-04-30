import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { CosmeticsService } from '../cosmetics/cosmetics.service';
import { CosmeticSource } from '../cosmetics/schemas/user-cosmetic.schema';
import { Currency, TxnType } from '../wallet/schemas/transaction.schema';
import { WalletService } from '../wallet/wallet.service';
import {
  DailyRewardConfig,
  DailyRewardConfigDocument,
  DailyRewardItem,
  RewardKind,
} from './schemas/daily-reward-config.schema';
import {
  UserDailyReward,
  UserDailyRewardDocument,
} from './schemas/user-daily-reward.schema';

const CONFIG_ID = 'default';

/**
 * UTC date key in YYYY-MM-DD form. We compare claim eligibility by UTC day
 * so a user always gets one shot per 24h regardless of where they are.
 */
function utcDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function utcDaysBetween(a: Date, b: Date): number {
  const aStart = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate());
  const bStart = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate());
  return Math.round((bStart - aStart) / 86_400_000);
}

@Injectable()
export class DailyRewardService {
  private readonly logger = new Logger(DailyRewardService.name);

  constructor(
    @InjectModel(DailyRewardConfig.name)
    private readonly configModel: Model<DailyRewardConfigDocument>,
    @InjectModel(UserDailyReward.name)
    private readonly userModel: Model<UserDailyRewardDocument>,
    private readonly wallet: WalletService,
    private readonly cosmetics: CosmeticsService,
  ) {}

  // ============== Config (admin) ==============

  /** The single config row, lazily upserted with empty days on first access. */
  async getOrCreateConfig(): Promise<DailyRewardConfigDocument> {
    let cfg = await this.configModel.findById(CONFIG_ID).exec();
    if (!cfg) {
      cfg = await this.configModel.create({
        _id: CONFIG_ID,
        version: 1,
        days: [],
        active: true,
      });
    }
    return cfg;
  }

  async upsertConfig(input: any): Promise<DailyRewardConfigDocument> {
    // Validate per-day reward shapes — each item needs the right field set.
    for (const day of input.days) {
      for (const r of day.rewards) {
        if (r.kind === RewardKind.COIN) {
          if (!r.coinAmount || r.coinAmount <= 0) {
            throw new BadRequestException({
              code: 'INVALID_COIN_REWARD',
              message: `Day ${day.day}: coin rewards need a positive coinAmount`,
            });
          }
        } else if (r.kind === RewardKind.COSMETIC) {
          if (!r.cosmeticItemId) {
            throw new BadRequestException({
              code: 'INVALID_COSMETIC_REWARD',
              message: `Day ${day.day}: cosmetic rewards need a cosmeticItemId`,
            });
          }
        }
      }
    }

    const cfg = await this.getOrCreateConfig();
    cfg.version = (cfg.version ?? 1) + 1;
    cfg.days = input.days.map((d: any) => ({
      day: d.day,
      isBigReward: d.isBigReward ?? false,
      rewards: d.rewards.map((r: any) => ({
        kind: r.kind,
        coinAmount: r.kind === RewardKind.COIN ? r.coinAmount : null,
        cosmeticItemId:
          r.kind === RewardKind.COSMETIC && r.cosmeticItemId
            ? new Types.ObjectId(r.cosmeticItemId)
            : null,
        cosmeticDurationDays: r.cosmeticDurationDays ?? 0,
      })),
    }));
    if (input.active !== undefined) cfg.active = input.active;
    await cfg.save();
    return cfg;
  }

  // ============== User-facing state ==============

  /**
   * Returns the user's view of the cycle: which day is next, whether they
   * can claim now, the full config so the mobile UI can render all 7
   * tiles, and their current streak position.
   */
  async getStateForUser(userId: string) {
    const cfg = await this.getOrCreateConfig();
    const state = await this.getOrCreateUserState(userId);

    // Detect cycle config change → reset streak so the user starts fresh.
    if (state.configVersion !== cfg.version) {
      state.configVersion = cfg.version;
      state.currentStreak = 0;
      state.lastClaimedAt = null;
      await state.save();
    }

    const now = new Date();
    const { todayDay, canClaim } = this.computeClaimWindow(state, now);

    return {
      config: cfg,
      state,
      todayDay,
      canClaim,
    };
  }

  /**
   * Atomic claim. Idempotency is keyed on `userId + UTC date` — a second
   * call on the same UTC day returns CLAIM_ALREADY_TAKEN.
   */
  async claim(userId: string) {
    const { config, state, todayDay, canClaim } = await this.getStateForUser(userId);
    if (!canClaim) {
      throw new ConflictException({
        code: 'ALREADY_CLAIMED',
        message: 'Daily reward already claimed for today',
      });
    }
    if (!config.active) {
      throw new ConflictException({
        code: 'DAILY_REWARD_DISABLED',
        message: 'Daily reward is currently disabled',
      });
    }
    const todaysConfig = config.days.find((d) => d.day === todayDay);
    if (!todaysConfig) {
      throw new NotFoundException({
        code: 'NO_REWARDS_TODAY',
        message: `No rewards configured for day ${todayDay}`,
      });
    }

    const dateKey = utcDateKey(new Date());
    const correlationId = `daily-${userId}-${dateKey}`;
    const awarded: DailyRewardItem[] = [];

    for (let i = 0; i < todaysConfig.rewards.length; i++) {
      const r = todaysConfig.rewards[i];
      if (r.kind === RewardKind.COIN) {
        await this.wallet.credit(Currency.COINS, {
          userId,
          amount: r.coinAmount ?? 0,
          type: TxnType.EVENT_REWARD,
          description: `Daily reward — day ${todayDay}`,
          idempotencyKey: `${correlationId}:coin:${i}`,
          refType: 'daily_reward',
        });
      } else if (r.kind === RewardKind.COSMETIC && r.cosmeticItemId) {
        await this.cosmetics.grantToUser({
          userId,
          cosmeticItemId: r.cosmeticItemId.toString(),
          source: CosmeticSource.EVENT,
          durationDays: r.cosmeticDurationDays > 0 ? r.cosmeticDurationDays : null,
          externalRef: `${correlationId}:cosmetic:${i}`,
        });
      }
      awarded.push(r);
    }

    // Advance the streak. After day 7, wrap back to 1 on the next claim.
    state.currentStreak = todayDay === 7 ? 0 : todayDay;
    state.lastClaimedAt = new Date();
    state.totalClaims = (state.totalClaims ?? 0) + 1;
    await state.save();

    return { awarded, claimedDay: todayDay, newStreak: state.currentStreak };
  }

  // ============== helpers ==============

  private async getOrCreateUserState(userId: string): Promise<UserDailyRewardDocument> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException({ code: 'INVALID_USER_ID', message: 'Invalid user id' });
    }
    const userObj = new Types.ObjectId(userId);
    return this.userModel
      .findOneAndUpdate(
        { userId: userObj },
        { $setOnInsert: { userId: userObj, currentStreak: 0, configVersion: 1 } },
        { upsert: true, new: true },
      )
      .exec();
  }

  /**
   * Decide which day index the user is on right now and whether the
   * current claim is open.
   *
   *   • Never claimed              → todayDay=1, canClaim=true
   *   • Claimed today (UTC)        → todayDay=currentStreak (or 7), canClaim=false
   *   • Claimed yesterday          → todayDay=currentStreak+1 (wraps 7→1), canClaim=true
   *   • Claimed 2+ days ago        → todayDay=1, canClaim=true (streak reset)
   */
  private computeClaimWindow(
    state: UserDailyRewardDocument,
    now: Date,
  ): { todayDay: number; canClaim: boolean } {
    if (!state.lastClaimedAt) {
      return { todayDay: 1, canClaim: true };
    }
    const days = utcDaysBetween(state.lastClaimedAt, now);
    if (days <= 0) {
      // Already claimed today → just show what they last got.
      const day = state.currentStreak === 0 ? 7 : state.currentStreak;
      return { todayDay: day, canClaim: false };
    }
    if (days === 1) {
      // Streak continues. After day 7 (stored as 0) we wrap back to 1.
      const next = state.currentStreak === 0 || state.currentStreak === 7
        ? 1
        : state.currentStreak + 1;
      return { todayDay: next, canClaim: true };
    }
    // Streak broken → start over.
    return { todayDay: 1, canClaim: true };
  }
}
