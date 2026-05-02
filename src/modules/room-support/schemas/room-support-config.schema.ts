import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type RoomSupportConfigDocument = HydratedDocument<RoomSupportConfig>;

/**
 * One reward tier on the Room Support ladder. A room "achieves" a level
 * when BOTH `minVisitors` AND `minCoins` are met for the week. Ties
 * resolve to the highest level the room qualifies for.
 *
 * Reward semantics (mirrors the in-app screen):
 *   ownerCoins  → paid to the room owner once the level is reached
 *   partnerCoins → paid to EACH selected room partner (max `partnerSlots`)
 *   totalCoins  → ownerCoins + partnerCoins * partnerSlots (denorm for UX)
 */
@Schema({ _id: false })
export class RoomSupportLevel {
  @Prop({ type: Number, required: true, min: 1 })
  level!: number;

  @Prop({ type: Number, required: true, min: 0 })
  minVisitors!: number;

  /** Coins gifted into the room during the week (sum across all gifts). */
  @Prop({ type: Number, required: true, min: 0 })
  minCoins!: number;

  @Prop({ type: Number, required: true, min: 0 })
  ownerCoins!: number;

  @Prop({ type: Number, required: true, min: 0 })
  partnerCoins!: number;

  @Prop({ type: Number, required: true, min: 0 })
  partnerSlots!: number;

  /** Pre-computed total = ownerCoins + partnerCoins * partnerSlots. */
  @Prop({ type: Number, required: true, min: 0 })
  totalCoins!: number;
}

export const RoomSupportLevelSchema = SchemaFactory.createForClass(RoomSupportLevel);

/**
 * Single-document config — one "_singleton" row holds the entire reward
 * ladder + the timezone we count weeks in. Lazily upserted on first read
 * with the Phase-1 default ladder pulled from the in-app screenshot.
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
export class RoomSupportConfig {
  @Prop({ type: String, required: true, unique: true, default: 'singleton' })
  key!: string;

  /**
   * IANA timezone the weekly window snaps to. Bangladesh = +05:30, so the
   * default is Asia/Dhaka — matches the in-app rules screen ("Monday
   * 00:00 to Sunday 23:59 (UTC +5:30)"). Admin can change this if the
   * platform expands to other markets.
   */
  @Prop({ type: String, default: 'Asia/Dhaka' })
  timezone!: string;

  @Prop({ type: [RoomSupportLevelSchema], default: [] })
  levels!: RoomSupportLevel[];

  /** Master kill switch — independent of family / agency toggles. */
  @Prop({ type: Boolean, default: true })
  enabled!: boolean;
}

export const RoomSupportConfigSchema = SchemaFactory.createForClass(RoomSupportConfig);
