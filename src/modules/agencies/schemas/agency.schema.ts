import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type AgencyDocument = HydratedDocument<Agency>;

export enum AgencyStatus {
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
export class Agency {
  @Prop({ type: String, required: true, trim: true })
  name!: string;

  @Prop({ type: String, required: true, unique: true, uppercase: true, trim: true })
  code!: string;

  @Prop({ type: String, default: '' })
  description!: string;

  @Prop({ type: String, default: 'BD', uppercase: true })
  country!: string;

  @Prop({ type: String, default: '' })
  logoUrl!: string;

  @Prop({ type: String, default: '' })
  contactEmail!: string;

  @Prop({ type: String, default: '' })
  contactPhone!: string;

  /** Commission percentage taken by the agency from host earnings (0–100). */
  @Prop({ type: Number, default: 30, min: 0, max: 100 })
  commissionRate!: number;

  @Prop({ type: String, enum: AgencyStatus, default: AgencyStatus.ACTIVE, index: true })
  status!: AgencyStatus;

  /** Denormalized counters — kept eventually consistent. */
  @Prop({ type: Number, default: 0 })
  hostCount!: number;

  @Prop({ type: Number, default: 0 })
  totalDiamondsEarned!: number;

  /** Linked admin user with `agency` role for this agency (optional). */
  @Prop({ type: Types.ObjectId, ref: 'AdminUser', default: null, index: true })
  ownerAdminId?: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'AdminUser', default: null })
  createdBy?: Types.ObjectId | null;
}

export const AgencySchema = SchemaFactory.createForClass(Agency);
AgencySchema.index({ code: 1 }, { unique: true });
AgencySchema.index({ name: 1 });
AgencySchema.index({ createdAt: -1 });
