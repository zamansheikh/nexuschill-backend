import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type MessageDocument = HydratedDocument<Message>;

export enum MessageStatus {
  ACTIVE = 'active',
  /** Sender or admin removed; rendered as "message deleted" client-side. */
  REMOVED = 'removed',
}

function refToId(v: unknown): unknown {
  if (v == null) return v;
  if (v instanceof Types.ObjectId) return v.toString();
  return v;
}

/**
 * A single 1-1 chat message. Persisted on send, fanned out via the
 * realtime gateway to both participants on `user:<id>` scopes so the
 * sender's other devices and the recipient receive it identically.
 *
 * Read state lives on the [Conversation] doc (per-user unread counter)
 * rather than per-message, since users typically mark a whole thread
 * read at once — keeps writes O(1) on read instead of N.
 */
@Schema({
  timestamps: true,
  toJSON: {
    transform: (_doc, ret: Record<string, any>) => {
      ret.id = ret._id?.toString();
      ret.conversationId = refToId(ret.conversationId);
      ret.authorId = refToId(ret.authorId);
      ret.recipientId = refToId(ret.recipientId);
      delete ret._id;
      delete ret.__v;
      return ret;
    },
  },
})
export class Message {
  @Prop({
    type: Types.ObjectId,
    ref: 'Conversation',
    required: true,
    index: true,
  })
  conversationId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  authorId!: Types.ObjectId;

  /** Denormalized — easier than indexing into participants for inbox
   *  unread aggregation, and avoids a second lookup on send. */
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  recipientId!: Types.ObjectId;

  @Prop({ type: String, required: true, maxlength: 1000 })
  text!: string;

  @Prop({
    type: String,
    enum: MessageStatus,
    default: MessageStatus.ACTIVE,
  })
  status!: MessageStatus;
}

export const MessageSchema = SchemaFactory.createForClass(Message);
MessageSchema.index({ conversationId: 1, createdAt: -1 });
