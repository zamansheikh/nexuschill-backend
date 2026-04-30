import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type RoomMemberDocument = HydratedDocument<RoomMember>;

export enum RoomRole {
  OWNER = 'owner',
  ADMIN = 'admin',
  MEMBER = 'member',
}

function refToId(v: unknown): unknown {
  if (v == null) return v;
  if (v instanceof Types.ObjectId) return v.toString();
  return v;
}

/**
 * Presence record — one row per user currently in a room. Created on enter,
 * removed on leave. Drives `viewerCount`, "who's here" listings, and the
 * realtime layer's authorization checks (only members can chat / take a
 * seat).
 *
 * We do NOT keep historical rows here; "who was ever in this room" isn't a
 * product question we need to answer. If it becomes one, switch to
 * soft-delete + a `leftAt` field instead.
 */
@Schema({
  timestamps: true,
  toJSON: {
    transform: (_doc, ret: Record<string, any>) => {
      ret.id = ret._id?.toString();
      ret.roomId = refToId(ret.roomId);
      ret.userId = refToId(ret.userId);
      delete ret._id;
      delete ret.__v;
      return ret;
    },
  },
})
export class RoomMember {
  @Prop({ type: Types.ObjectId, ref: 'Room', required: true, index: true })
  roomId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ type: String, enum: RoomRole, default: RoomRole.MEMBER, index: true })
  role!: RoomRole;

  @Prop({ type: Date, default: () => new Date() })
  joinedAt!: Date;

  /** Heartbeat — bumped on each enter/realtime ping. Lets a sweeper drop
   *  zombie rows where the client crashed without sending leave. */
  @Prop({ type: Date, default: () => new Date(), index: true })
  lastSeenAt!: Date;
}

export const RoomMemberSchema = SchemaFactory.createForClass(RoomMember);
// One presence row per (room, user). Re-entering a room is an upsert.
RoomMemberSchema.index({ roomId: 1, userId: 1 }, { unique: true });
RoomMemberSchema.index({ roomId: 1, lastSeenAt: -1 });
