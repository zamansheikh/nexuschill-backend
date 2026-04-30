import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type RoomChatMessageDocument = HydratedDocument<RoomChatMessage>;

export enum RoomChatStatus {
  ACTIVE = 'active',
  /** Hidden by host/admin moderation. */
  REMOVED = 'removed',
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
      ret.roomId = refToId(ret.roomId);
      ret.authorId = refToId(ret.authorId);
      delete ret._id;
      delete ret.__v;
      return ret;
    },
  },
})
export class RoomChatMessage {
  @Prop({ type: Types.ObjectId, ref: 'Room', required: true, index: true })
  roomId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  authorId!: Types.ObjectId;

  @Prop({ type: String, required: true, maxlength: 300 })
  text!: string;

  @Prop({ type: String, enum: RoomChatStatus, default: RoomChatStatus.ACTIVE, index: true })
  status!: RoomChatStatus;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  removedBy?: Types.ObjectId | null;
}

export const RoomChatMessageSchema = SchemaFactory.createForClass(RoomChatMessage);
RoomChatMessageSchema.index({ roomId: 1, createdAt: -1 });
