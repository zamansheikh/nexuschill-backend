import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type MomentLikeDocument = HydratedDocument<MomentLike>;

/**
 * One row per (user, moment) pair. Existence = liked. We use a unique
 * compound index instead of a flag so:
 *   • likes are reliably idempotent under retries
 *   • un-likes are a deleteOne
 *   • the count is a countDocuments() and the membership is a findOne()
 */
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
export class MomentLike {
  @Prop({ type: Types.ObjectId, ref: 'Moment', required: true, index: true })
  momentId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;
}

export const MomentLikeSchema = SchemaFactory.createForClass(MomentLike);
MomentLikeSchema.index({ momentId: 1, userId: 1 }, { unique: true });
