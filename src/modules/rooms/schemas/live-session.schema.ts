import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

import { RoomKind } from './room.schema';

export type LiveSessionDocument = HydratedDocument<LiveSession>;

/**
 * One row per "session in a room" — created when a user leaves a room
 * (or is evicted) so we can attribute the time they spent live to
 * their profile. Drives the per-user "Live Record" page (Today /
 * Weekly / Monthly breakdown of audio vs video minutes).
 *
 * We could compute this on-the-fly from RoomMember timestamps, but
 * RoomMember rows are deleted on leave — the historical signal
 * would vanish with them. A dedicated append-only collection
 * survives the membership lifecycle and keeps the aggregation
 * cheap: a single `$match + $group` over the per-day bucket.
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
export class LiveSession {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Room', required: true })
  roomId!: Types.ObjectId;

  /** Snapshot of `room.kind` at the time of leaving — survives even
   *  if the room itself is later deleted, and lets us split the
   *  "audio vs video" totals without a join. */
  @Prop({ type: String, enum: RoomKind, required: true, index: true })
  roomKind!: RoomKind;

  /** Number of seconds the user spent in the room (lastSeenAt - joinedAt
   *  at the time of leaving). Clamped to >= 0 on insert. */
  @Prop({ type: Number, required: true, min: 0 })
  durationSec!: number;

  /** When the session actually ended (leave timestamp). The pipeline
   *  uses this for the day/week/month bucket so a long-running room
   *  attributes its minutes to the day the user left, not the day
   *  they joined. */
  @Prop({ type: Date, required: true, index: true })
  endedAt!: Date;
}

export const LiveSessionSchema = SchemaFactory.createForClass(LiveSession);
LiveSessionSchema.index({ userId: 1, endedAt: -1 });
LiveSessionSchema.index({ userId: 1, roomKind: 1, endedAt: -1 });
