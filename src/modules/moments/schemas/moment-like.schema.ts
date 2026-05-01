import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type MomentLikeDocument = HydratedDocument<MomentLike>;

/**
 * The set of reactions a user can put on a moment. Mirrors the Facebook
 * vocabulary so the UI can map 1:1 to familiar emoji. Adding a new value
 * is safe — existing clients render unknown kinds as the generic `like`.
 */
export enum ReactionKind {
  LIKE = 'like',
  LOVE = 'love',
  HAHA = 'haha',
  WOW = 'wow',
  SAD = 'sad',
  ANGRY = 'angry',
}

/**
 * One row per (user, moment) pair. Class is still named `MomentLike` and
 * the collection stays at the original name (`momentlikes`) for zero
 * migration; the `kind` field below extends the binary like into a
 * Facebook-style reaction. Existing rows without `kind` are treated as
 * `like` (server-side default + mobile-side fallback).
 *
 *   • Reactions are idempotent — a second reaction from the same user
 *     just updates the kind via upsert.
 *   • Un-reacting is `deleteOne`.
 *   • Per-kind counts come from a `$group` aggregation on read.
 */
@Schema({
  timestamps: true,
  collection: 'momentlikes',
  toJSON: {
    transform: (_doc, ret: Record<string, any>) => {
      ret.id = ret._id?.toString();
      delete ret._id;
      delete ret.__v;
      return ret;
    },
  },
})
export class MomentLike {
  @Prop({ type: Types.ObjectId, ref: 'Moment', required: true, index: true })
  momentId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({
    type: String,
    enum: ReactionKind,
    default: ReactionKind.LIKE,
    index: true,
  })
  kind!: ReactionKind;
}

export const MomentLikeSchema = SchemaFactory.createForClass(MomentLike);
MomentLikeSchema.index({ momentId: 1, userId: 1 }, { unique: true });
