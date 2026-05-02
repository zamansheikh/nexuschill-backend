import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ResellerDocument = HydratedDocument<Reseller>;

export enum ResellerStatus {
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
  TERMINATED = 'terminated',
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
export class Reseller {
  /** 7-digit public ID (1_000_000+) — see User.numericId for rationale. */
  @Prop({ type: Number, unique: true, sparse: true, index: true })
  numericId?: number;

  @Prop({ type: String, required: true, trim: true })
  name!: string;

  @Prop({ type: String, required: true, unique: true, uppercase: true, trim: true })
  code!: string;

  @Prop({ type: String, default: '' })
  description!: string;

  @Prop({ type: String, default: 'BD', uppercase: true })
  country!: string;

  @Prop({ type: String, default: '' })
  contactEmail!: string;

  @Prop({ type: String, default: '' })
  contactPhone!: string;

  // ----- Coin pool -----

  /** Coins held by this reseller, ready to be assigned to users. */
  @Prop({ type: Number, default: 0, min: 0 })
  coinPool!: number;

  /** Optional cap on the pool size. 0 = no limit. */
  @Prop({ type: Number, default: 0, min: 0 })
  creditLimit!: number;

  /**
   * Informational only at this stage — stored for future use when payment
   * integration tracks money. e.g. a reseller may give 5% bonus to users.
   */
  @Prop({ type: Number, default: 0, min: 0, max: 100 })
  commissionRate!: number;

  // ----- Counters -----

  @Prop({ type: Number, default: 0 })
  lifetimeCoinsReceived!: number;

  @Prop({ type: Number, default: 0 })
  lifetimeCoinsAssigned!: number;

  // ----- Status & ownership -----

  @Prop({ type: String, enum: ResellerStatus, default: ResellerStatus.ACTIVE, index: true })
  status!: ResellerStatus;

  @Prop({ type: Types.ObjectId, ref: 'AdminUser', default: null, index: true })
  ownerAdminId?: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'AdminUser', default: null })
  createdBy?: Types.ObjectId | null;
}

export const ResellerSchema = SchemaFactory.createForClass(Reseller);
// `code` and `numericId` are already indexed via `@Prop({ unique: true })` —
// re-declaring here triggers Mongoose duplicate-index warnings.
ResellerSchema.index({ name: 1 });
ResellerSchema.index({ createdAt: -1 });
