import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type RoomSeatDocument = HydratedDocument<RoomSeat>;

function refToId(v: unknown): unknown {
  if (v == null) return v;
  if (v instanceof Types.ObjectId) return v.toString();
  return v;
}

/**
 * One row per seat slot in a room. Seats are pre-created on room creation so
 * the realtime layer can address them by `(roomId, seatIndex)` without
 * worrying about whether the row exists yet.
 *
 * `seatIndex` 0 is reserved for the owner's center mic; 1..micCount are the
 * guest seats laid out in the grid.
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
export class RoomSeat {
  @Prop({ type: Types.ObjectId, ref: 'Room', required: true, index: true })
  roomId!: Types.ObjectId;

  @Prop({ type: Number, required: true, min: 0, max: 15 })
  seatIndex!: number;

  /** null = empty seat. */
  @Prop({ type: Types.ObjectId, ref: 'User', default: null, index: true })
  userId?: Types.ObjectId | null;

  /** Locked seats can't be taken by anyone except an admin invite. */
  @Prop({ type: Boolean, default: false })
  locked!: boolean;

  /** Force-muted by host. The user keeps the seat but can't publish audio. */
  @Prop({ type: Boolean, default: false })
  muted!: boolean;

  @Prop({ type: Date, default: null })
  joinedAt?: Date | null;
}

export const RoomSeatSchema = SchemaFactory.createForClass(RoomSeat);
RoomSeatSchema.index({ roomId: 1, seatIndex: 1 }, { unique: true });
RoomSeatSchema.index({ roomId: 1, userId: 1 });
