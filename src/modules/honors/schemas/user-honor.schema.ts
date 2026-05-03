import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type UserHonorDocument = HydratedDocument<UserHonor>;

/// How the user came to hold this honor — drives audit trails and
/// keeps the admin grant flow distinct from the auto-award path.
export enum HonorSource {
  ADMIN_GRANT = 'admin_grant',
  TASK = 'task',
  EVENT = 'event',
  PURCHASE = 'purchase',
}

/**
 * Per-user inventory of earned honors. One row per (userId,
 * honorItemId). Re-grants update `tier` + bump `awardedAt` rather
 * than insert a duplicate; the unique index makes the upsert atomic.
 */
@Schema({
  timestamps: true,
  toJSON: {
    transform: (_doc, ret: Record<string, any>) => {
      ret.id = ret._id?.toString();
      ret.userId = ret.userId?.toString?.() ?? ret.userId;
      ret.honorItemId =
        ret.honorItemId?.toString?.() ?? ret.honorItemId;
      ret.awardedBy = ret.awardedBy?.toString?.() ?? ret.awardedBy;
      delete ret._id;
      delete ret.__v;
      return ret;
    },
  },
})
export class UserHonor {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'HonorItem', required: true, index: true })
  honorItemId!: Types.ObjectId;

  /** 1..maxTier on the linked HonorItem. Visualised as star count. */
  @Prop({ type: Number, default: 1, min: 1, max: 10 })
  tier!: number;

  @Prop({ type: String, enum: HonorSource, default: HonorSource.ADMIN_GRANT })
  source!: HonorSource;

  /** Admin who issued the grant — only set when source = ADMIN_GRANT. */
  @Prop({ type: Types.ObjectId, ref: 'AdminUser', default: null })
  awardedBy?: Types.ObjectId | null;

  /** Free-form audit note set by the granting admin. */
  @Prop({ type: String, default: '', maxlength: 200 })
  note!: string;

  @Prop({ type: Date, default: () => new Date() })
  awardedAt!: Date;
}

export const UserHonorSchema = SchemaFactory.createForClass(UserHonor);
UserHonorSchema.index({ userId: 1, honorItemId: 1 }, { unique: true });
UserHonorSchema.index({ userId: 1, awardedAt: -1 });
