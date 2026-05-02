import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type UserSvipStatusDocument = HydratedDocument<UserSvipStatus>;

/**
 * Per-user SVIP state. Created lazily when a user first earns SVIP points
 * or when the admin manually grants a tier. The "current month points"
 * field is the running total for the active calendar month — a scheduled
 * job will reset it on the first of each month and recompute the user's
 * tier (next sprint).
 */
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
export class UserSvipStatus {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, unique: true, index: true })
  userId!: Types.ObjectId;

  /** 0 = no SVIP. 1..9 = currently holding that tier. */
  @Prop({ type: Number, default: 0, min: 0, max: 9 })
  currentLevel!: number;

  /** Highest tier the user has ever held — drives one-time rewards. */
  @Prop({ type: Number, default: 0, min: 0, max: 9 })
  highestLevel!: number;

  /** Running total for the current calendar month. Reset on month rollover. */
  @Prop({ type: Number, default: 0, min: 0 })
  monthlyPoints!: number;

  /** When the current monthly window ends (typically first-of-next-month UTC). */
  @Prop({ type: Date, default: null })
  monthlyResetAt?: Date | null;

  /** When the user's SVIP membership lapses (if any). */
  @Prop({ type: Date, default: null, index: true })
  expiresAt?: Date | null;
}

export const UserSvipStatusSchema = SchemaFactory.createForClass(UserSvipStatus);
// `userId` is already indexed via `@Prop({ unique: true })`.
UserSvipStatusSchema.index({ currentLevel: 1 });
