import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type LiveDayRecordDocument = HydratedDocument<LiveDayRecord>;

/**
 * One row per (user, calendar date in Asia/Dhaka) summarising the host's
 * live time on that day. Audio and video are tracked separately —
 * 30 min audio + 30 min video stays BELOW the daily threshold, but
 * 45 min of audio alone earns an `audioValid` day. `isValid` is the
 * union (either kind crossed the threshold) and feeds the monthly
 * count.
 *
 * Materialised once per night by the live-record cron from
 * `LiveSession` rows of the previous day. Storing the rollup
 * separately keeps the monthly query a single indexed `$match` on a
 * tiny collection instead of grouping over the entire session log
 * every time a Live Record page opens.
 */
@Schema({
  timestamps: true,
  toJSON: {
    transform: (_doc, ret: Record<string, any>) => {
      ret.id = ret._id?.toString();
      ret.userId = ret.userId?.toString?.() ?? ret.userId;
      delete ret._id;
      delete ret.__v;
      return ret;
    },
  },
})
export class LiveDayRecord {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  /** Calendar date in Asia/Dhaka, formatted as ISO `YYYY-MM-DD`. The
   *  string form sidesteps any timezone confusion — the cron picks
   *  the date once at aggregation time and writes the canonical
   *  bucket label that the mobile UI displays as-is. */
  @Prop({ type: String, required: true })
  date!: string;

  /** Denormalised year / month / day. Lets the monthly read pull
   *  `{ userId, year, month }` without parsing the date string and
   *  matches the index. */
  @Prop({ type: Number, required: true })
  year!: number;

  @Prop({ type: Number, required: true, min: 1, max: 12 })
  month!: number;

  @Prop({ type: Number, required: true, min: 1, max: 31 })
  day!: number;

  @Prop({ type: Number, required: true, default: 0, min: 0 })
  audioSec!: number;

  @Prop({ type: Number, required: true, default: 0, min: 0 })
  videoSec!: number;

  /** Did this day's audio time cross the configured daily threshold? */
  @Prop({ type: Boolean, required: true, default: false })
  audioValid!: boolean;

  /** Did this day's video time cross the configured daily threshold? */
  @Prop({ type: Boolean, required: true, default: false })
  videoValid!: boolean;

  /** Union — at least one kind earned the day. Drives the monthly
   *  valid-day count. */
  @Prop({ type: Boolean, required: true, default: false })
  isValid!: boolean;

  /** Has the daily reward been credited to the host's wallet for
   *  this day? Set true once the cron's wallet credit completes;
   *  acts as the idempotency guard against double-credit on cron
   *  re-run. */
  @Prop({ type: Boolean, required: true, default: false })
  rewarded!: boolean;

  /** Snapshot of the reward amount at the time of credit. Lets a
   *  later config change not retroactively rewrite a host's
   *  historical day rows. Null when `rewarded=false`. */
  @Prop({ type: Number, default: null })
  rewardAmount!: number | null;

  /** Snapshot of currency at credit time. Same reason as
   *  `rewardAmount`. */
  @Prop({ type: String, enum: ['coins', 'diamonds', null], default: null })
  rewardCurrency!: 'coins' | 'diamonds' | null;
}

export const LiveDayRecordSchema = SchemaFactory.createForClass(LiveDayRecord);
// One row per host per calendar date.
LiveDayRecordSchema.index({ userId: 1, date: 1 }, { unique: true });
// Drives the monthly read on the Live Record page.
LiveDayRecordSchema.index({ userId: 1, year: 1, month: 1 });
