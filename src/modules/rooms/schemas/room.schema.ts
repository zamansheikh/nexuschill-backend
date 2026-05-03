import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type RoomDocument = HydratedDocument<Room>;

/** Distinguishes future video rooms from today's audio-only rooms. */
export enum RoomKind {
  AUDIO = 'audio',
  VIDEO = 'video',
}

export enum RoomStatus {
  ACTIVE = 'active',
  /** Permanently closed by owner. */
  CLOSED = 'closed',
  /** Hidden by admin moderation. */
  REMOVED = 'removed',
}

export enum ChatPolicy {
  ANYONE = 'anyone',
  FOLLOWERS = 'followers',
  ADMINS = 'admins',
}

export enum MicPolicy {
  ANYONE = 'anyone',
  ADMINS = 'admins',
}

@Schema({ _id: false })
export class RoomPolicies {
  @Prop({ type: String, enum: ChatPolicy, default: ChatPolicy.ANYONE })
  chat!: ChatPolicy;

  @Prop({ type: String, enum: MicPolicy, default: MicPolicy.ANYONE })
  mic!: MicPolicy;

  /**
   * "Super mic" — owner's mic gets visual boost + priority audio routing.
   * Pure UX flag for now; the audio side just keeps publishing.
   */
  @Prop({ type: Boolean, default: false })
  superMic!: boolean;
}
const RoomPoliciesSchema = SchemaFactory.createForClass(RoomPolicies);

@Schema({ _id: false })
export class KickHistoryEntry {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  byUserId!: Types.ObjectId;

  @Prop({ type: String, default: '' })
  reason!: string;

  @Prop({ type: Date, default: () => new Date() })
  at!: Date;
}
const KickHistoryEntrySchema = SchemaFactory.createForClass(KickHistoryEntry);

// Stringify ObjectId only when not populated. Populated subdocs come back as
// plain objects whose own toJSON has already done the work; calling
// toString on them yields "[object Object]".
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
      ret.ownerId = refToId(ret.ownerId);
      if (Array.isArray(ret.adminUserIds)) {
        ret.adminUserIds = ret.adminUserIds.map(refToId);
      }
      if (Array.isArray(ret.blockedUserIds)) {
        ret.blockedUserIds = ret.blockedUserIds.map(refToId);
      }
      ret.themeCosmeticId = refToId(ret.themeCosmeticId);
      delete ret._id;
      delete ret.__v;
      // Don't leak the password hash.
      delete ret.passwordHash;
      return ret;
    },
  },
})
export class Room {
  /**
   * One room per owner. Enforced at the service layer + a unique index on
   * `ownerId, kind` so future video rooms can coexist with audio rooms
   * (one of each type per user).
   */
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  ownerId!: Types.ObjectId;

  @Prop({ type: String, enum: RoomKind, default: RoomKind.AUDIO, index: true })
  kind!: RoomKind;

  /** 7-digit public ID — what users type to find a room. */
  @Prop({ type: Number, unique: true, sparse: true, index: true })
  numericId?: number;

  @Prop({ type: String, required: true, maxlength: 60 })
  name!: string;

  @Prop({ type: String, default: '', maxlength: 1000 })
  announcement!: string;

  /**
   * Room cover picture URL. Defaults to the owner's avatar at create
   * time so the room has a sensible identity image immediately. Owner
   * can override via the settings sheet — the new URL broadcasts via
   * ROOM_SETTINGS_UPDATED so every client reflects the change live.
   */
  @Prop({ type: String, default: '' })
  coverUrl!: string;

  /** Cosmetic the owner equipped as the room background (ROOM_CARD type). */
  @Prop({ type: Types.ObjectId, ref: 'CosmeticItem', default: null })
  themeCosmeticId?: Types.ObjectId | null;

  /** bcrypt hash — empty string means no password. */
  @Prop({ type: String, default: '', select: false })
  passwordHash!: string;

  /** Number of guest seats (excluding owner seat at index 0). 8–15. */
  @Prop({ type: Number, default: 8, min: 4, max: 15 })
  micCount!: number;

  @Prop({ type: RoomPoliciesSchema, default: () => ({}) })
  policies!: RoomPolicies;

  @Prop({ type: [{ type: Types.ObjectId, ref: 'User' }], default: [] })
  adminUserIds!: Types.ObjectId[];

  @Prop({ type: [{ type: Types.ObjectId, ref: 'User' }], default: [] })
  blockedUserIds!: Types.ObjectId[];

  @Prop({ type: [KickHistoryEntrySchema], default: [] })
  kickHistory!: KickHistoryEntry[];

  // Live-state denorm — updated on enter/leave so the room card on Mine /
  // home can paint without a second query.
  @Prop({ type: Number, default: 0, min: 0 })
  viewerCount!: number;

  @Prop({ type: Date, default: null, index: true })
  liveAt?: Date | null;

  @Prop({ type: String, enum: RoomStatus, default: RoomStatus.ACTIVE, index: true })
  status!: RoomStatus;

  /** Set when an admin removes the room. */
  @Prop({ type: Types.ObjectId, ref: 'AdminUser', default: null })
  removedBy?: Types.ObjectId | null;

  @Prop({ type: String, default: '' })
  removedReason!: string;
}

export const RoomSchema = SchemaFactory.createForClass(Room);
// One audio room + (eventually) one video room per owner.
RoomSchema.index({ ownerId: 1, kind: 1 }, { unique: true });
RoomSchema.index({ status: 1, viewerCount: -1 });
RoomSchema.index({ status: 1, liveAt: -1 });
