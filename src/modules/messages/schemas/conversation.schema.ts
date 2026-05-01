import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ConversationDocument = HydratedDocument<Conversation>;

function refToId(v: unknown): unknown {
  if (v == null) return v;
  if (v instanceof Types.ObjectId) return v.toString();
  return v;
}

/**
 * One-to-one conversation between two users. Both participants share the
 * same conversation document; their unread counts are tracked in the
 * `unread` map keyed by userId.
 *
 * The `participants` array is always sorted ascending so we can build a
 * unique index that guarantees idempotent get-or-create. Pre-sorting also
 * makes the index usable from either direction (A→B and B→A find the
 * same row).
 */
@Schema({
  timestamps: true,
  toJSON: {
    transform: (_doc, ret: Record<string, any>) => {
      ret.id = ret._id?.toString();
      ret.participants = (ret.participants ?? []).map(refToId);
      ret.lastMessageId = refToId(ret.lastMessageId);
      // The `unread` map persists with ObjectId keys — JSON-friendly
      // form is `Record<userId, number>`.
      if (ret.unread instanceof Map) {
        ret.unread = Object.fromEntries(ret.unread);
      }
      delete ret._id;
      delete ret.__v;
      return ret;
    },
  },
})
export class Conversation {
  @Prop({
    type: [{ type: Types.ObjectId, ref: 'User' }],
    required: true,
    validate: {
      validator: (v: Types.ObjectId[]) => Array.isArray(v) && v.length === 2,
      message: 'Conversation must have exactly 2 participants',
    },
  })
  participants!: Types.ObjectId[];

  /** Pointer to the most recent message — used to render the inbox preview
   *  without an extra query per row. */
  @Prop({ type: Types.ObjectId, ref: 'Message', default: null })
  lastMessageId?: Types.ObjectId | null;

  /** Cached preview text + author so the inbox list can render in one query. */
  @Prop({ type: String, default: '' })
  lastMessageText!: string;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  lastMessageAuthorId?: Types.ObjectId | null;

  /** When the last message landed. Inbox sorts by this descending. */
  @Prop({ type: Date, default: null, index: true })
  lastMessageAt?: Date | null;

  /** Per-user unread counter. Keyed by participant userId (string). */
  @Prop({ type: Map, of: Number, default: () => new Map<string, number>() })
  unread!: Map<string, number>;
}

export const ConversationSchema = SchemaFactory.createForClass(Conversation);
// Idempotent get-or-create — sorting participants on insert lets this
// catch both directions (A,B and B,A pre-sort to the same key).
ConversationSchema.index({ participants: 1 }, { unique: true });
ConversationSchema.index({ participants: 1, lastMessageAt: -1 });
