import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type MagicBallTaskDocument = HydratedDocument<MagicBallTask>;

/**
 * Discriminator on a task — defines what counts as progress and which
 * subsystem ticks it. New kinds plug in here as features land.
 *
 *   • mic_minutes        — minutes the user spent on a mic seat today
 *   • invites_completed  — invitees that accepted a seat the user offered
 *   • gifts_sent         — gifts the user sent today (count, not coins)
 *   • gifts_received     — gifts the user received today
 *   • chat_messages      — chat messages the user posted in any room
 *   • room_visitors      — distinct visitors to the user's owned room
 */
export enum MagicBallTaskKind {
  MIC_MINUTES = 'mic_minutes',
  INVITES_COMPLETED = 'invites_completed',
  GIFTS_SENT = 'gifts_sent',
  GIFTS_RECEIVED = 'gifts_received',
  CHAT_MESSAGES = 'chat_messages',
  ROOM_VISITORS = 'room_visitors',
}

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
export class MagicBallTask {
  /** What the user sees, e.g. "On mic for 10 minutes". */
  @Prop({ type: String, required: true, trim: true })
  label!: string;

  @Prop({ type: String, enum: MagicBallTaskKind, required: true, index: true })
  kind!: MagicBallTaskKind;

  /** Numeric goal for the chosen kind. e.g. kind=mic_minutes, goal=10. */
  @Prop({ type: Number, required: true, min: 1 })
  goal!: number;

  /** Coins credited to the user when they claim a completed task. */
  @Prop({ type: Number, required: true, min: 0 })
  rewardCoins!: number;

  @Prop({ type: Number, default: 0, index: true })
  sortOrder!: number;

  @Prop({ type: Boolean, default: true, index: true })
  active!: boolean;

  @Prop({ type: Types.ObjectId, ref: 'AdminUser', default: null })
  createdBy?: Types.ObjectId | null;
}

export const MagicBallTaskSchema = SchemaFactory.createForClass(MagicBallTask);
MagicBallTaskSchema.index({ active: 1, sortOrder: -1, createdAt: -1 });
