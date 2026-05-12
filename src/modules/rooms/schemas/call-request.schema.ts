import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type CallRequestDocument = HydratedDocument<CallRequest>;

function refToId(v: unknown): unknown {
  if (v == null) return v;
  if (v instanceof Types.ObjectId) return v.toString();
  return v;
}

/**
 * Viewer-initiated call request for host-broadcast video rooms. A
 * viewer that wants to join the host's stage as an audio caller fires
 * one of these; the host sees them collected in the call-management
 * sheet and can approve (which turns into a `SEAT_INVITED` + take-seat
 * flow) or deny.
 *
 * Requests carry a 5-minute TTL so abandoned requests vanish without
 * the host having to clean them up — MongoDB's TTL monitor deletes
 * rows where `expiresAt` is in the past. A unique `(roomId, userId)`
 * index prevents the same viewer from spamming the host with multiple
 * requests.
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
export class CallRequest {
  @Prop({ type: Types.ObjectId, ref: 'Room', required: true, index: true })
  roomId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  /**
   * TTL anchor. MongoDB drops the document when `now > expiresAt`.
   * Set to `now + 5 min` on create; the controller never touches it
   * after that. Cleanup happens server-side on the TTL monitor
   * sweep (default ~60s), so requests can hang around up to a minute
   * past nominal expiry — acceptable for this UX.
   */
  @Prop({ type: Date, required: true, index: { expireAfterSeconds: 0 } })
  expiresAt!: Date;
}

export const CallRequestSchema = SchemaFactory.createForClass(CallRequest);
// One pending request per (room, user) — a viewer who already has a
// pending request can't double-tap to spam.
CallRequestSchema.index({ roomId: 1, userId: 1 }, { unique: true });
