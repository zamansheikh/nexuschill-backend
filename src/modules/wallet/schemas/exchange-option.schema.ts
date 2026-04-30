import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ExchangeOptionDocument = HydratedDocument<ExchangeOption>;

/**
 * One row on the "Exchange diamonds → coins" screen. Each row is a fixed
 * tier (1K diamonds → 330 coins, 10K → 3,300, etc). The user picks a
 * tier; the server atomically debits the diamonds and credits the coins.
 *
 * Stored as separate options rather than a flat exchange rate so admins
 * can offer non-linear bonuses (e.g. higher tiers with kicker rewards).
 */
@Schema({
  collection: 'exchange_options',
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
export class ExchangeOption {
  /** How many diamonds the user spends. */
  @Prop({ type: Number, required: true, min: 1 })
  diamondsRequired!: number;

  /** How many coins they receive. */
  @Prop({ type: Number, required: true, min: 1 })
  coinsAwarded!: number;

  @Prop({ type: Number, default: 0, index: true })
  sortOrder!: number;

  @Prop({ type: Boolean, default: true, index: true })
  active!: boolean;

  @Prop({ type: Types.ObjectId, ref: 'AdminUser', default: null })
  createdBy?: Types.ObjectId | null;
}

export const ExchangeOptionSchema = SchemaFactory.createForClass(ExchangeOption);
ExchangeOptionSchema.index({ active: 1, sortOrder: 1, diamondsRequired: 1 });
