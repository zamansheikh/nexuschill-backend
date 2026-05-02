import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type LuckyBagDocument = HydratedDocument<LuckyBag>;

export enum LuckyBagStatus {
  /** Some slots still unclaimed and not yet expired. */
  PENDING = 'pending',
  /** Every slot has been claimed. */
  DEPLOYED = 'depleted',
  /** Lifetime ran out; remaining unclaimed coins refunded to sender. */
  EXPIRED = 'expired',
}

/**
 * One claim record — appended to `claims` when a recipient grabs a slot.
 * `slotIndex` references the position in the (immutable) `slotAmounts`
 * array generated at create time; this guarantees every claim takes a
 * unique pre-computed amount, so total never exceeds `totalCoins`.
 */
@Schema({ _id: false })
export class LuckyBagClaim {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId!: Types.ObjectId;

  @Prop({ type: Number, required: true, min: 1 })
  slotIndex!: number;

  @Prop({ type: Number, required: true, min: 0 })
  amount!: number;

  @Prop({ type: Date, default: () => new Date() })
  claimedAt!: Date;
}

export const LuckyBagClaimSchema = SchemaFactory.createForClass(LuckyBagClaim);

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
export class LuckyBag {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  senderId!: Types.ObjectId;

  /** Optional — null for personal/profile bags; set for in-room ones. */
  @Prop({ type: Types.ObjectId, ref: 'Room', default: null, index: true })
  roomId?: Types.ObjectId | null;

  @Prop({ type: Number, required: true, min: 1 })
  totalCoins!: number;

  @Prop({ type: Number, required: true, min: 1 })
  slotCount!: number;

  /**
   * Pre-computed individual amounts that sum to `totalCoins`. Generated
   * at create time using a "leftover" random algorithm so each claimant
   * gets a distinct random portion. The array is immutable; claimants
   * just pull off the lowest unclaimed slotIndex.
   */
  @Prop({ type: [Number], default: [] })
  slotAmounts!: number[];

  /**
   * Index of the next slot to hand out. Atomically incremented on claim
   * via `$inc` so concurrent claims never grab the same slot.
   */
  @Prop({ type: Number, default: 0 })
  nextSlotIndex!: number;

  @Prop({ type: [LuckyBagClaimSchema], default: [] })
  claims!: LuckyBagClaim[];

  /**
   * Recipients can claim only AFTER this time. Mirrors the in-app card
   * countdown — typically `createdAt + 12s`. Backend enforces the gate.
   */
  @Prop({ type: Date, required: true })
  availableAt!: Date;

  /** When the bag expires + any unclaimed coins are refunded. */
  @Prop({ type: Date, required: true, index: true })
  expiresAt!: Date;

  @Prop({ type: String, enum: LuckyBagStatus, default: LuckyBagStatus.PENDING, index: true })
  status!: LuckyBagStatus;

  /**
   * Wallet idempotencyKey for the sender's debit (used to ensure a
   * retry of POST /lucky-bag never double-debits). Surfaced for audit.
   */
  @Prop({ type: String, default: '' })
  debitIdempotencyKey!: string;
}

export const LuckyBagSchema = SchemaFactory.createForClass(LuckyBag);
LuckyBagSchema.index({ roomId: 1, status: 1, createdAt: -1 });
LuckyBagSchema.index({ senderId: 1, createdAt: -1 });
