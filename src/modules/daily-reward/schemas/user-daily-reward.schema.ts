import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type UserDailyRewardDocument = HydratedDocument<UserDailyReward>;

/**
 * Per-user state in the rolling 7-day check-in cycle.
 *
 *  • `currentStreak` — how many consecutive UTC days the user has claimed,
 *    capped at 7. After day 7, the next claim wraps back to day 1.
 *  • `lastClaimedAt` — UTC timestamp of the most recent claim. Used to
 *    decide whether today is claimable and whether the streak should
 *    advance, hold, or reset.
 *  • `configVersion` — the cycle version this row's `currentStreak` is
 *    valid for. Bumped admin-side when the config changes; on mismatch
 *    we reset the user back to "fresh cycle, day 1 available".
 */
@Schema({
  timestamps: true,
  toJSON: {
    transform: (_doc, ret: Record<string, any>) => {
      ret.id = ret._id?.toString();
      ret.userId = ret.userId?.toString();
      delete ret._id;
      delete ret.__v;
      return ret;
    },
  },
})
export class UserDailyReward {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, unique: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ type: Number, default: 0, min: 0, max: 7 })
  currentStreak!: number;

  @Prop({ type: Date, default: null })
  lastClaimedAt?: Date | null;

  @Prop({ type: Number, default: 1 })
  configVersion!: number;

  /** Total claims across all cycles — useful for analytics. */
  @Prop({ type: Number, default: 0 })
  totalClaims!: number;
}

export const UserDailyRewardSchema = SchemaFactory.createForClass(UserDailyReward);
// `userId` is already indexed via `@Prop({ unique: true })`.
UserDailyRewardSchema.index({ lastClaimedAt: -1 });
