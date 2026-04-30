import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type TransactionDocument = HydratedDocument<Transaction>;

export enum Currency {
  COINS = 'coins',
  BEANS = 'beans',
}

export enum TxnDirection {
  CREDIT = 'credit',
  DEBIT = 'debit',
}

export enum TxnType {
  RECHARGE = 'recharge',
  RECHARGE_BONUS = 'recharge_bonus',
  /** Admin minted coins directly to a user (no real money). */
  MINT = 'mint',
  /** Coins assigned to a user from a reseller's pool. */
  RESELLER_TOPUP = 'reseller_topup',
  GIFT_SEND = 'gift_send',
  GIFT_RECEIVE = 'gift_receive',
  WITHDRAWAL = 'withdrawal',
  WITHDRAWAL_REVERSAL = 'withdrawal_reversal',
  ADMIN_CREDIT = 'admin_credit',
  ADMIN_DEBIT = 'admin_debit',
  EVENT_REWARD = 'event_reward',
  REFERRAL_BONUS = 'referral_bonus',
  TASK_REWARD = 'task_reward',
  REFUND = 'refund',
  CONVERSION = 'conversion',
}

export enum TxnStatus {
  COMPLETED = 'completed',
  REVERSED = 'reversed',
}

@Schema({
  timestamps: true,
  toJSON: {
    transform: (_doc, ret: Record<string, any>) => {
      ret.id = ret._id?.toString();
      ret.walletId = ret.walletId?.toString();
      ret.userId = ret.userId?.toString();
      if (ret.refId) ret.refId = ret.refId.toString();
      if (ret.performedBy) ret.performedBy = ret.performedBy.toString();
      if (ret.reversedBy) ret.reversedBy = ret.reversedBy.toString();
      delete ret._id;
      delete ret.__v;
      return ret;
    },
  },
})
export class Transaction {
  /** Unique key for idempotent operations (e.g. payment-webhook IDs). */
  @Prop({ type: String, required: true, unique: true, index: true })
  idempotencyKey!: string;

  /**
   * Groups paired entries (e.g. sender-debit + receiver-credit for a gift).
   * Same correlationId → same logical event.
   */
  @Prop({ type: String, required: true, index: true })
  correlationId!: string;

  @Prop({ type: Types.ObjectId, ref: 'Wallet', required: true, index: true })
  walletId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ type: String, enum: Currency, required: true })
  currency!: Currency;

  @Prop({ type: String, enum: TxnDirection, required: true })
  direction!: TxnDirection;

  /** Always positive. Direction tells you whether it adds to or removes from the wallet. */
  @Prop({ type: Number, required: true, min: 0 })
  amount!: number;

  @Prop({ type: String, enum: TxnType, required: true, index: true })
  type!: TxnType;

  @Prop({ type: String, default: '' })
  description!: string;

  /** Optional pointer to a domain object (gift, recharge order, etc.) */
  @Prop({ type: String, default: null })
  refType?: string | null;

  @Prop({ type: Types.ObjectId, default: null })
  refId?: Types.ObjectId | null;

  /** Wallet balance for this currency *after* this transaction. Useful for audits. */
  @Prop({ type: Number, required: true })
  balanceAfter!: number;

  /** Admin id if performed by an admin (admin_credit / admin_debit / freeze). */
  @Prop({ type: Types.ObjectId, default: null })
  performedBy?: Types.ObjectId | null;

  @Prop({ type: String, default: '' })
  performedByIp!: string;

  @Prop({ type: String, enum: TxnStatus, default: TxnStatus.COMPLETED, index: true })
  status!: TxnStatus;

  /** If reversed, points to the reversal transaction. */
  @Prop({ type: Types.ObjectId, default: null })
  reversedBy?: Types.ObjectId | null;

  @Prop({ type: String, default: '' })
  notes!: string;
}

export const TransactionSchema = SchemaFactory.createForClass(Transaction);

TransactionSchema.index({ idempotencyKey: 1 }, { unique: true });
TransactionSchema.index({ correlationId: 1 });
TransactionSchema.index({ userId: 1, createdAt: -1 });
TransactionSchema.index({ walletId: 1, createdAt: -1 });
TransactionSchema.index({ type: 1, createdAt: -1 });
TransactionSchema.index({ refType: 1, refId: 1 });
