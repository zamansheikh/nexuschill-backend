import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type LiveMonthRecordDocument = HydratedDocument<LiveMonthRecord>;

/**
 * Monthly aggregate + monthly-bonus claim ledger. One row per
 * (user, year, month). Created lazily — first when the mobile Live
 * Record page opens that month (so the page can show a `claimed=true`
 * sentinel after the host claims) and any time the daily cron tops
 * up the valid-day count.
 *
 * The valid-day count is recomputed from `LiveDayRecord` on every
 * read so it stays accurate without the cron having to touch this
 * collection on every nightly run. The fields below are mostly the
 * claim ledger — bonus amount + timestamp + PDF cache key.
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
export class LiveMonthRecord {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ type: Number, required: true })
  year!: number;

  @Prop({ type: Number, required: true, min: 1, max: 12 })
  month!: number;

  /** Snapshot of the monthly valid-day count at the moment of
   *  claim. Pre-claim this stays null; the read endpoint computes
   *  the live count from LiveDayRecord rows instead. */
  @Prop({ type: Number, default: null })
  validDaysAtClaim!: number | null;

  /** Set true once the host claims the monthly bonus from the
   *  Live Record page. Idempotency guard against double-claim. */
  @Prop({ type: Boolean, required: true, default: false })
  claimed!: boolean;

  @Prop({ type: Date, default: null })
  claimedAt!: Date | null;

  /** Snapshot of the bonus amount at claim time. */
  @Prop({ type: Number, default: null })
  bonusAmount!: number | null;

  /** Snapshot of currency at claim time. */
  @Prop({ type: String, enum: ['coins', 'diamonds', null], default: null })
  bonusCurrency!: 'coins' | 'diamonds' | null;

  /** Wallet transaction id for the bonus credit. Lets the PDF
   *  reference an audit trail, and supports a future "show me my
   *  claim" deep link. */
  @Prop({ type: Types.ObjectId, default: null })
  bonusTxnId!: Types.ObjectId | null;
}

export const LiveMonthRecordSchema =
  SchemaFactory.createForClass(LiveMonthRecord);
LiveMonthRecordSchema.index(
  { userId: 1, year: 1, month: 1 },
  { unique: true },
);
