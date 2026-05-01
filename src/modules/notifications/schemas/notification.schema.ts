import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type NotificationDocument = HydratedDocument<Notification>;

/**
 * The kinds of notifications the platform can produce. Add new values
 * here when a new event source comes online — clients render unknown
 * kinds with a generic icon, so old clients don't break when the
 * server emits a kind they haven't seen yet.
 */
export enum NotificationKind {
  /** A 1-1 chat message arrived from another user. Used as the
   *  "Activity" feed entry — the actual message lives in the messages
   *  feature; this is just a notification surface for the recipient. */
  MESSAGE = 'message',
  /** Someone followed you. */
  FOLLOW = 'follow',
  /** Free-form admin push (e.g. "New season starts tomorrow"). */
  SYSTEM = 'system',
  /** Family invite / join / role change. */
  FAMILY = 'family',
  /** Activity / event / promotion banner. */
  ACTIVITY = 'activity',
}

/**
 * Where tapping the notification takes the user. Mirrors the global
 * notice link kinds so the same router shim handles both surfaces.
 */
export enum NotificationLinkKind {
  NONE = 'none',
  ROUTE = 'route',
  USER = 'user',
  ROOM = 'room',
  CHAT = 'chat',
  WEB = 'web',
}

function refToId(v: unknown): unknown {
  if (v == null) return v;
  if (v instanceof Types.ObjectId) return v.toString();
  return v;
}

@Schema({
  timestamps: true,
  toJSON: {
    transform: (_doc, ret: Record<string, any>) => {
      ret.id = ret._id?.toString();
      ret.userId = refToId(ret.userId);
      ret.actorId = refToId(ret.actorId);
      delete ret._id;
      delete ret.__v;
      return ret;
    },
  },
})
export class Notification {
  /** Recipient. Indexed for the inbox query (newest-first per user). */
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  /** Optional triggering user — set for FOLLOW / MESSAGE / FAMILY
   *  invite. Hydrated on read so the client can render avatar+name
   *  without a follow-up lookup. */
  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  actorId?: Types.ObjectId | null;

  @Prop({
    type: String,
    enum: NotificationKind,
    required: true,
    index: true,
  })
  kind!: NotificationKind;

  /** Short headline. Rendered on a single line in the inbox row. */
  @Prop({ type: String, required: true, maxlength: 200 })
  title!: string;

  /** Body / preview text. Rendered as a 1-2 line excerpt below the
   *  title. Empty for kinds where the title alone says everything
   *  (e.g. "Mr Leoo followed you"). */
  @Prop({ type: String, default: '', maxlength: 500 })
  body!: string;

  /** Optional thumbnail (icon, banner image). Empty falls back to a
   *  kind-specific glyph on the client. */
  @Prop({ type: String, default: '' })
  imageUrl!: string;

  @Prop({
    type: String,
    enum: NotificationLinkKind,
    default: NotificationLinkKind.NONE,
  })
  linkKind!: NotificationLinkKind;

  /** Interpretation depends on linkKind:
   *   - ROUTE → app route path (`/wallet`, `/store`)
   *   - USER  → userId (Mongo _id) for the public profile route
   *   - ROOM  → roomId
   *   - CHAT  → peer userId (drives the 1-1 thread)
   *   - WEB   → https URL */
  @Prop({ type: String, default: '' })
  linkValue!: string;

  /** False until the user opens the inbox / taps the row. */
  @Prop({ type: Boolean, default: false, index: true })
  read!: boolean;
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);
NotificationSchema.index({ userId: 1, createdAt: -1 });
NotificationSchema.index({ userId: 1, read: 1 });
