import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type WalletDocument = HydratedDocument<Wallet>;

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
export class Wallet {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, unique: true, index: true })
  userId!: Types.ObjectId;

  /** Spending currency (purchased with real money). */
  @Prop({ type: Number, default: 0, min: 0 })
  coins!: number;

  /** Earning currency (received from gifts). Convertible to USD on withdrawal. */
  @Prop({ type: Number, default: 0, min: 0 })
  beans!: number;

  // ----- Lifetime aggregates (denormalized for fast reads) -----

  @Prop({ type: Number, default: 0 })
  lifetimeCoinsRecharged!: number;

  @Prop({ type: Number, default: 0 })
  lifetimeCoinsSpent!: number;

  @Prop({ type: Number, default: 0 })
  lifetimeBeansEarned!: number;

  @Prop({ type: Number, default: 0 })
  lifetimeBeansWithdrawn!: number;

  // ----- Admin controls -----

  @Prop({ type: Boolean, default: false })
  frozen!: boolean;

  @Prop({ type: String, default: '' })
  frozenReason!: string;

  @Prop({ type: Date, default: null })
  frozenAt?: Date | null;

  @Prop({ type: Types.ObjectId, default: null })
  frozenBy?: Types.ObjectId | null;
}

export const WalletSchema = SchemaFactory.createForClass(Wallet);
WalletSchema.index({ userId: 1 }, { unique: true });
WalletSchema.index({ frozen: 1 });
