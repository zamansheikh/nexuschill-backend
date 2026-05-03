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
 * Idempotent get-or-create is enforced by a derived `pairKey`
 * (`<smallerId>_<largerId>`) with a unique index. A unique index directly
 * on the `participants` array won't work — Mongo treats each array
 * element as a separate index entry, so a unique index there would
 * forbid a user from ever having more than one conversation.
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

  /** Deterministic key for the participant pair: `<smallerObjectId>_<largerObjectId>`.
   *  Carries the unique constraint so both A→B and B→A resolve to the
   *  same row. */
  @Prop({ type: String, required: true, unique: true, index: true })
  pairKey!: string;

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
// Inbox lookup: list every conversation a user participates in, newest first.
ConversationSchema.index({ participants: 1, lastMessageAt: -1 });

/**
 * Build the deterministic pair key for two participant ids. The smaller
 * id (lexicographic) goes first so both A→B and B→A produce the same
 * value, which the unique index on `pairKey` then enforces.
 */
export function buildPairKey(
  a: Types.ObjectId | string,
  b: Types.ObjectId | string,
): string {
  const aStr = a.toString();
  const bStr = b.toString();
  return aStr < bStr ? `${aStr}_${bStr}` : `${bStr}_${aStr}`;
}
