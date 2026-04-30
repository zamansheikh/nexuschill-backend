import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ResellerLedgerDocument = HydratedDocument<ResellerLedger>;

export enum ResellerLedgerType {
  /** Admin minted coins into this reseller's pool. */
  POOL_TOPUP = 'pool_topup',
  /** Admin clawed back coins from the pool (rare). */
  POOL_CLAWBACK = 'pool_clawback',
  /** Reseller distributed coins to a user. */
  ASSIGNMENT = 'assignment',
  /** Manual adjustment for accounting fixes. */
  ADJUSTMENT = 'adjustment',
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
export class ResellerLedger {
  @Prop({ type: String, required: true, unique: true, index: true })
  idempotencyKey!: string;

  @Prop({ type: Types.ObjectId, ref: 'Reseller', required: true, index: true })
  resellerId!: Types.ObjectId;

  @Prop({ type: String, enum: ['credit', 'debit'], required: true })
  direction!: 'credit' | 'debit';

  @Prop({ type: Number, required: true, min: 0 })
  amount!: number;

  @Prop({ type: String, enum: ResellerLedgerType, required: true, index: true })
  type!: ResellerLedgerType;

  @Prop({ type: String, default: '' })
  reason!: string;

  /** Pool balance after this entry — for audits. */
  @Prop({ type: Number, required: true })
  poolBalanceAfter!: number;

  // ----- Refs -----

  @Prop({ type: Types.ObjectId, ref: 'AdminUser', required: true })
  performedBy!: Types.ObjectId;

  /** For type=ASSIGNMENT: the user who received coins. */
  @Prop({ type: Types.ObjectId, ref: 'User', default: null, index: true })
  recipientUserId?: Types.ObjectId | null;

  /** Linked wallet transaction on the recipient user side (for ASSIGNMENT). */
  @Prop({ type: Types.ObjectId, ref: 'Transaction', default: null })
  userTxnId?: Types.ObjectId | null;
}

export const ResellerLedgerSchema = SchemaFactory.createForClass(ResellerLedger);
ResellerLedgerSchema.index({ idempotencyKey: 1 }, { unique: true });
ResellerLedgerSchema.index({ resellerId: 1, createdAt: -1 });
ResellerLedgerSchema.index({ type: 1, createdAt: -1 });
