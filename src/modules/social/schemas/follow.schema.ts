import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type FollowDocument = HydratedDocument<Follow>;

/**
 * Single edge in the social graph: `followerId` → `followeeId`.
 *
 * One row per directed pair; mutual follows are two rows. The unique
 * compound index on `(followerId, followeeId)` keeps double-follow a
 * no-op and is also the read-path index for the "who am I following?"
 * + "who follows me?" queries.
 *
 * No "approved / pending" flag — follows on this product are public,
 * one-step. If we ever bolt on private accounts, add a `status` field
 * here rather than a parallel collection.
 */
@Schema({
  timestamps: true,
  toJSON: {
    transform: (_doc, ret: Record<string, any>) => {
      ret.id = ret._id?.toString();
      ret.followerId = ret.followerId?.toString?.() ?? ret.followerId;
      ret.followeeId = ret.followeeId?.toString?.() ?? ret.followeeId;
      delete ret._id;
      delete ret.__v;
      return ret;
    },
  },
})
export class Follow {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  followerId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  followeeId!: Types.ObjectId;
}

export const FollowSchema = SchemaFactory.createForClass(Follow);
// Unique edge: idempotent on duplicate-follow.
FollowSchema.index({ followerId: 1, followeeId: 1 }, { unique: true });
// "Who follows me, newest first" — supports the followers list.
FollowSchema.index({ followeeId: 1, createdAt: -1 });
// "Who am I following, newest first" — supports the following list.
FollowSchema.index({ followerId: 1, createdAt: -1 });
