import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type MomentDocument = HydratedDocument<Moment>;

export enum MomentStatus {
  ACTIVE = 'active',
  /** Hidden by admin moderation; not returned in public feeds. */
  REMOVED = 'removed',
  /** Author deleted. Kept in DB for a short audit window. */
  DELETED = 'deleted',
}

@Schema({ _id: false })
export class MomentMedia {
  @Prop({ type: String, required: true })
  url!: string;

  @Prop({ type: String, default: '' })
  publicId!: string;

  @Prop({ type: String, enum: ['image', 'video'], default: 'image' })
  kind!: 'image' | 'video';

  @Prop({ type: Number, default: 0 })
  width!: number;

  @Prop({ type: Number, default: 0 })
  height!: number;
}
const MomentMediaSchema = SchemaFactory.createForClass(MomentMedia);

@Schema({
  timestamps: true,
  toJSON: {
    transform: (_doc, ret: Record<string, any>) => {
      ret.id = ret._id?.toString();
      // authorId is the only ref — when populated, leave the subdoc alone;
      // when not, stringify the ObjectId. Same pattern as the cosmetics fix.
      const a = ret.authorId;
      if (a != null && a instanceof Types.ObjectId) {
        ret.authorId = a.toString();
      }
      delete ret._id;
      delete ret.__v;
      return ret;
    },
  },
})
export class Moment {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  authorId!: Types.ObjectId;

  /** Caption / body text. Optional — image-only posts are allowed. */
  @Prop({ type: String, default: '', maxlength: 2000 })
  text!: string;

  @Prop({ type: [MomentMediaSchema], default: [] })
  media!: MomentMedia[];

  // Denormalized counters — single source of truth still lives in
  // MomentLike + (later) MomentComment, but we cache totals here so the
  // feed query stays a single round-trip.
  @Prop({ type: Number, default: 0, min: 0 })
  likeCount!: number;

  @Prop({ type: Number, default: 0, min: 0 })
  commentCount!: number;

  @Prop({ type: String, enum: MomentStatus, default: MomentStatus.ACTIVE, index: true })
  status!: MomentStatus;

  /** Set when an admin removes the post. Useful for audit + appeals. */
  @Prop({ type: Types.ObjectId, ref: 'AdminUser', default: null })
  removedBy?: Types.ObjectId | null;

  @Prop({ type: String, default: '' })
  removedReason!: string;

  @Prop({ type: Date, default: null })
  removedAt?: Date | null;
}

export const MomentSchema = SchemaFactory.createForClass(Moment);
MomentSchema.index({ status: 1, createdAt: -1 });
MomentSchema.index({ authorId: 1, createdAt: -1 });
