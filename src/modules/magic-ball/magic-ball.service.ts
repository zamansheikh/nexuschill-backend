import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';

import { Currency, TxnType } from '../wallet/schemas/transaction.schema';
import { WalletService } from '../wallet/wallet.service';
import {
  MagicBallProgress,
  MagicBallProgressDocument,
} from './schemas/magic-ball-progress.schema';
import {
  MagicBallTask,
  MagicBallTaskDocument,
  MagicBallTaskKind,
} from './schemas/magic-ball-task.schema';

/**
 * Asia/Dhaka is UTC+05:30 with no DST — same convention used by the
 * Room Support feature. Day boundaries are computed against this offset
 * so the 0:00 → 0:00 reset matches the in-app rules.
 */
const TZ_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

interface ListAdminParams {
  page?: number;
  limit?: number;
  active?: boolean;
  kind?: MagicBallTaskKind;
}

export interface MagicBallTaskState {
  task: MagicBallTaskDocument;
  /** Counter for the task's `kind` today. */
  progress: number;
  /** progress >= goal? */
  completed: boolean;
  claimed: boolean;
}

export interface MagicBallSummary {
  dayKey: string;
  cumulativeCoinsAllTime: number;
  /** Hint to the UI for the "Cumulatively obtained" headline. */
  todayClaimedCoins: number;
  tasks: MagicBallTaskState[];
}

@Injectable()
export class MagicBallService {
  constructor(
    @InjectModel(MagicBallTask.name)
    private readonly taskModel: Model<MagicBallTaskDocument>,
    @InjectModel(MagicBallProgress.name)
    private readonly progressModel: Model<MagicBallProgressDocument>,
    private readonly wallet: WalletService,
  ) {}

  // ============================================================
  // Admin: task CRUD
  // ============================================================

  async listAdminTasks(params: ListAdminParams) {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(100, Math.max(1, params.limit ?? 30));
    const skip = (page - 1) * limit;

    const filter: FilterQuery<MagicBallTaskDocument> = {};
    if (params.active !== undefined) filter.active = params.active;
    if (params.kind !== undefined) filter.kind = params.kind;

    const [items, total] = await Promise.all([
      this.taskModel
        .find(filter)
        .sort({ sortOrder: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.taskModel.countDocuments(filter).exec(),
    ]);
    return { items, page, limit, total };
  }

  async getTaskOrThrow(id: string): Promise<MagicBallTaskDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException({ code: 'TASK_NOT_FOUND', message: 'Task not found' });
    }
    const task = await this.taskModel.findById(id).exec();
    if (!task) {
      throw new NotFoundException({ code: 'TASK_NOT_FOUND', message: 'Task not found' });
    }
    return task;
  }

  async createTask(input: any, createdBy?: string): Promise<MagicBallTaskDocument> {
    return this.taskModel.create({
      ...input,
      createdBy:
        createdBy && Types.ObjectId.isValid(createdBy)
          ? new Types.ObjectId(createdBy)
          : null,
    });
  }

  async updateTask(id: string, update: any): Promise<MagicBallTaskDocument> {
    const t = await this.getTaskOrThrow(id);
    if (update.label !== undefined) t.label = update.label;
    if (update.kind !== undefined) t.kind = update.kind;
    if (update.goal !== undefined) t.goal = update.goal;
    if (update.rewardCoins !== undefined) t.rewardCoins = update.rewardCoins;
    if (update.sortOrder !== undefined) t.sortOrder = update.sortOrder;
    if (update.active !== undefined) t.active = update.active;
    await t.save();
    return t;
  }

  async deleteTask(id: string): Promise<void> {
    const t = await this.getTaskOrThrow(id);
    await this.taskModel.deleteOne({ _id: t._id }).exec();
  }

  // ============================================================
  // User: read summary, increment, claim
  // ============================================================

  async getMySummary(userId: string): Promise<MagicBallSummary> {
    const dayKey = this.getDayKey(new Date());
    if (!Types.ObjectId.isValid(userId)) {
      // Defensive fallback — without a user we still want the page to
      // render the task list, just with zero progress.
      const tasks = await this.taskModel
        .find({ active: true })
        .sort({ sortOrder: -1, createdAt: -1 })
        .exec();
      return {
        dayKey,
        cumulativeCoinsAllTime: 0,
        todayClaimedCoins: 0,
        tasks: tasks.map((t) => ({
          task: t,
          progress: 0,
          completed: false,
          claimed: false,
        })),
      };
    }

    const userObj = new Types.ObjectId(userId);
    const [tasks, progress] = await Promise.all([
      this.taskModel
        .find({ active: true })
        .sort({ sortOrder: -1, createdAt: -1 })
        .exec(),
      this.progressModel.findOne({ userId: userObj, dayKey }).exec(),
    ]);

    // Cumulative all-time runs across days, so we read the latest doc
    // per user (highest dayKey) regardless of "today". Cheap — at most
    // one row per user-day.
    const latest = await this.progressModel
      .findOne({ userId: userObj })
      .sort({ dayKey: -1 })
      .select({ cumulativeCoinsAllTime: 1 })
      .exec();

    const counters = progress?.counters ?? {};
    const claimedSet = new Set(
      (progress?.claimedTaskIds ?? []).map((id) => id.toString()),
    );

    const todayClaimedCoins = tasks
      .filter((t) => claimedSet.has(t._id.toString()))
      .reduce((sum, t) => sum + t.rewardCoins, 0);

    return {
      dayKey,
      cumulativeCoinsAllTime: latest?.cumulativeCoinsAllTime ?? 0,
      todayClaimedCoins,
      tasks: tasks.map((t) => {
        const p = counters[t.kind] ?? 0;
        return {
          task: t,
          progress: p,
          completed: p >= t.goal,
          claimed: claimedSet.has(t._id.toString()),
        };
      }),
    };
  }

  /**
   * Generic counter bump. Other modules call this when a tracked event
   * fires (mic-leave → mic_minutes, invite accepted → invites_completed,
   * etc.). Idempotent at the cumulative-counter level — callers don't
   * need to dedupe themselves.
   */
  async incrementProgress(
    userId: string,
    kind: MagicBallTaskKind,
    amount: number,
  ): Promise<void> {
    if (!Types.ObjectId.isValid(userId) || amount <= 0) return;
    const dayKey = this.getDayKey(new Date());
    await this.progressModel
      .updateOne(
        { userId: new Types.ObjectId(userId), dayKey },
        {
          $inc: { [`counters.${kind}`]: amount },
          $setOnInsert: {
            userId: new Types.ObjectId(userId),
            dayKey,
            claimedTaskIds: [],
          },
        },
        { upsert: true },
      )
      .exec();
  }

  /**
   * Claim a completed task. Atomic on the wallet credit + the
   * `claimedTaskIds` push so a double-tap can't double-pay.
   */
  async claimReward(
    userId: string,
    taskId: string,
  ): Promise<{ rewardCoins: number; cumulativeCoinsAllTime: number }> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User not found' });
    }
    const task = await this.getTaskOrThrow(taskId);
    if (!task.active) {
      throw new ConflictException({
        code: 'TASK_INACTIVE',
        message: 'This task is no longer active.',
      });
    }

    const dayKey = this.getDayKey(new Date());
    const userObj = new Types.ObjectId(userId);

    // 1. Refuse early if already claimed today. Race between two requests
    //    is closed by the dedup-on-push update below.
    const existing = await this.progressModel
      .findOne({ userId: userObj, dayKey })
      .exec();
    if (
      existing?.claimedTaskIds?.some((id) => id.equals(task._id))
    ) {
      throw new ConflictException({
        code: 'ALREADY_CLAIMED',
        message: 'You already claimed this task today.',
      });
    }
    const progress = existing?.counters?.[task.kind] ?? 0;
    if (progress < task.goal) {
      throw new ConflictException({
        code: 'TASK_INCOMPLETE',
        message: 'Task is not complete yet.',
        details: { progress, goal: task.goal },
      });
    }

    // 2. Atomic push — only succeeds if the task isn't already in the set.
    //    If another request slipped in first, modifiedCount will be 0.
    const claim = await this.progressModel
      .updateOne(
        {
          userId: userObj,
          dayKey,
          claimedTaskIds: { $ne: task._id },
        },
        {
          $push: { claimedTaskIds: task._id },
          $inc: { cumulativeCoinsAllTime: task.rewardCoins },
        },
      )
      .exec();
    if (claim.modifiedCount === 0) {
      throw new ConflictException({
        code: 'ALREADY_CLAIMED',
        message: 'You already claimed this task today.',
      });
    }

    // 3. Credit the wallet. If this throws, the dedup is already in
    //    place — admin can manually compensate. Idempotency key is
    //    deterministic per (user, task, day) so re-entry is a no-op.
    await this.wallet.credit(Currency.COINS, {
      userId,
      amount: task.rewardCoins,
      type: TxnType.MAGIC_BALL_REWARD,
      description: `Magic Ball: ${task.label}`,
      idempotencyKey: `magic-ball:${userId}:${task._id.toString()}:${dayKey}`,
      refType: 'magic_ball_task',
      refId: task._id.toString(),
      performedBy: userId,
    });

    // 4. Re-read to return the fresh cumulative for the page hero.
    const after = await this.progressModel
      .findOne({ userId: userObj, dayKey })
      .select({ cumulativeCoinsAllTime: 1 })
      .exec();
    return {
      rewardCoins: task.rewardCoins,
      cumulativeCoinsAllTime: after?.cumulativeCoinsAllTime ?? task.rewardCoins,
    };
  }

  // ============================================================
  // Convenience hooks — invoked from other modules / mobile clients
  // ============================================================

  /** Mobile reports a finished mic session (in seconds). Service rounds
   * to whole minutes for the `mic_minutes` counter so a 90-second
   * session contributes 1, not 1.5. */
  async recordMicSessionSeconds(userId: string, seconds: number): Promise<void> {
    if (seconds <= 0) return;
    const minutes = Math.floor(seconds / 60);
    if (minutes <= 0) return;
    await this.incrementProgress(userId, MagicBallTaskKind.MIC_MINUTES, minutes);
  }

  // ============================================================
  // Helpers
  // ============================================================

  /**
   * yyyy-MM-dd in Asia/Dhaka. Unique per local day so the daily counter
   * resets at 0:00 local. Independent of server time zone.
   */
  getDayKey(now: Date): string {
    const local = new Date(now.getTime() + TZ_OFFSET_MS);
    const y = local.getUTCFullYear();
    const m = (local.getUTCMonth() + 1).toString().padStart(2, '0');
    const d = local.getUTCDate().toString().padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
}
