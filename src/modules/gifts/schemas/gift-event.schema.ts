import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type GiftEventDocument = HydratedDocument<GiftEvent>;

export enum GiftContext {
  PROFILE = 'profile',
  ROOM = 'room',
  LIVE = 'live',
  PK = 'pk',
  DM = 'dm',
}

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
export class GiftEvent {
  @Prop({ type: Types.ObjectId, ref: 'Gift', required: true, index: true })
  giftId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  senderId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  receiverId!: Types.ObjectId;

  @Prop({ type: Number, required: true, min: 1 })
  count!: number;

  @Prop({ type: Number, required: true, min: 1 })
  totalCoinAmount!: number;

  @Prop({ type: Number, required: true, min: 0 })
  totalBeanReward!: number;

  @Prop({ type: String, enum: GiftContext, default: GiftContext.PROFILE })
  contextType!: GiftContext;

  /** Optional reference to the room / stream / pk_battle this gift was sent in. */
  @Prop({ type: Types.ObjectId, default: null })
  contextId?: Types.ObjectId | null;

  @Prop({ type: String, default: '' })
  message!: string;

  /** Linked ledger entries (debit on sender, credit on receiver). */
  @Prop({ type: Types.ObjectId, ref: 'Transaction', default: null })
  senderTxnId?: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'Transaction', default: null })
  receiverTxnId?: Types.ObjectId | null;

  /** Set on the very first attempt with this idempotencyKey, then echoed back. */
  @Prop({ type: String, required: true, unique: true, index: true })
  idempotencyKey!: string;

  @Prop({ type: String, enum: ['completed', 'reversed'], default: 'completed' })
  status!: 'completed' | 'reversed';
}

export const GiftEventSchema = SchemaFactory.createForClass(GiftEvent);
GiftEventSchema.index({ idempotencyKey: 1 }, { unique: true });
GiftEventSchema.index({ senderId: 1, createdAt: -1 });
GiftEventSchema.index({ receiverId: 1, createdAt: -1 });
GiftEventSchema.index({ giftId: 1, createdAt: -1 });
GiftEventSchema.index({ contextType: 1, contextId: 1, createdAt: -1 });
