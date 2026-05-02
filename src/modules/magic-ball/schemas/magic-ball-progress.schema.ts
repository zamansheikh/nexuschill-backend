import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

import { MagicBallTaskKind } from './magic-ball-task.schema';

export type MagicBallProgressDocument = HydratedDocument<MagicBallProgress>;

/**
 * Per-user progress for ONE day, keyed on a yyyy-MM-dd day-string in
 * Asia/Dhaka tz so the unique index is straight-forward and the daily
 * reset is implicit (a new day → new doc, prior day's row stays around
 * for analytics).
 *
 * Counters live by `kind` rather than by taskId — multiple tasks can
 * share the same kind (e.g. "On mic for 10 min" + "On mic for 60 min"),
 * and they all read off the same counter.
 *
 * `claimedTaskIds` is the dedup set so the same task can't be claimed
 * twice in a single day.
 */
@Schema({
  timestamps: true,
  toJSON: {
    transform: (_doc, ret: Record<string, any>) => {
      ret.id = ret._id?.toString();
      delete ret._id;
      delete ret.__v;
      return ret;
    },
  },
})
export class MagicBallProgress {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  /** yyyy-MM-dd in Asia/Dhaka — see MagicBallService.getDayKey(). */
  @Prop({ type: String, required: true, index: true })
  dayKey!: string;

  /**
   * Map of kind → cumulative count for the day. Stored as a Mongo
   * sub-document with explicit MagicBallTaskKind keys so we can do
   * dotted updates (`$inc: { 'counters.mic_minutes': 5 }`).
   *
   * Type is loose because Mongoose handles Map<string, number> OK but
   * the static type plays nicer as an indexed object.
   */
  @Prop({ type: Object, default: {} })
  counters!: Partial<Record<MagicBallTaskKind, number>>;

  /** Task IDs the user has already claimed today. */
  @Prop({ type: [Types.ObjectId], default: [] })
  claimedTaskIds!: Types.ObjectId[];

  /**
   * Sum of rewardCoins claimed across ALL days for this user — kept on
   * the latest doc as a denormalised "Cumulatively obtained coin bonus"
   * counter for the page hero. Updated atomically when a task is claimed.
   */
  @Prop({ type: Number, default: 0 })
  cumulativeCoinsAllTime!: number;
}

export const MagicBallProgressSchema =
  SchemaFactory.createForClass(MagicBallProgress);

// One row per (user, day) — the canonical lookup pattern.
MagicBallProgressSchema.index({ userId: 1, dayKey: 1 }, { unique: true });
