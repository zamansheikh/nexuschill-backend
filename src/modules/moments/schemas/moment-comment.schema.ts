import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type MomentCommentDocument = HydratedDocument<MomentComment>;

export enum CommentStatus {
  ACTIVE = 'active',
  /** Hidden by admin moderation. */
  REMOVED = 'removed',
  /** Soft-deleted by author. */
  DELETED = 'deleted',
}

@Schema({
  timestamps: true,
  toJSON: {
    transform: (_doc, ret: Record<string, any>) => {
      ret.id = ret._id?.toString();
      const a = ret.authorId;
      if (a != null && a instanceof Types.ObjectId) {
        ret.authorId = a.toString();
      }
      const m = ret.momentId;
      if (m != null && m instanceof Types.ObjectId) {
        ret.momentId = m.toString();
      }
      const p = ret.parentId;
      if (p != null && p instanceof Types.ObjectId) {
        ret.parentId = p.toString();
      }
      delete ret._id;
      delete ret.__v;
      return ret;
    },
  },
})
export class MomentComment {
  @Prop({ type: Types.ObjectId, ref: 'Moment', required: true, index: true })
  momentId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  authorId!: Types.ObjectId;

  @Prop({ type: String, required: true, maxlength: 500 })
  text!: string;

  /**
   * Optional parent comment id — supports a single layer of replies.
   * The list endpoint returns flat order (newest-first) for now; mobile
   * renders replies inline by `parentId`. Threaded UI is a later round.
   */
  @Prop({ type: Types.ObjectId, ref: 'MomentComment', default: null, index: true })
  parentId?: Types.ObjectId | null;

  @Prop({ type: String, enum: CommentStatus, default: CommentStatus.ACTIVE, index: true })
  status!: CommentStatus;

  @Prop({ type: Types.ObjectId, ref: 'AdminUser', default: null })
  removedBy?: Types.ObjectId | null;

  @Prop({ type: String, default: '' })
  removedReason!: string;
}

export const MomentCommentSchema = SchemaFactory.createForClass(MomentComment);
MomentCommentSchema.index({ momentId: 1, createdAt: -1 });
MomentCommentSchema.index({ authorId: 1, createdAt: -1 });
