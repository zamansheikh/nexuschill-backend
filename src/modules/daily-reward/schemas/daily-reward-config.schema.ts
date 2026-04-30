import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type DailyRewardConfigDocument = HydratedDocument<DailyRewardConfig>;

/** Each entry on a day's reward list. Days can mix coins + cosmetics. */
export enum RewardKind {
  COIN = 'coin',
  COSMETIC = 'cosmetic',
}

@Schema({ _id: false })
export class DailyRewardItem {
  @Prop({ type: String, enum: RewardKind, required: true })
  kind!: RewardKind;

  /** Required when kind=coin. */
  @Prop({ type: Number, default: null })
  coinAmount?: number | null;

  /** Required when kind=cosmetic. */
  @Prop({ type: Types.ObjectId, ref: 'CosmeticItem', default: null })
  cosmeticItemId?: Types.ObjectId | null;

  /** Days the cosmetic stays in the user's inventory. 0 = permanent. */
  @Prop({ type: Number, default: 0, min: 0 })
  cosmeticDurationDays!: number;
}
const DailyRewardItemSchema = SchemaFactory.createForClass(DailyRewardItem);

@Schema({ _id: false })
export class DailyRewardDay {
  @Prop({ type: Number, required: true, min: 1, max: 7 })
  day!: number;

  @Prop({ type: [DailyRewardItemSchema], default: [] })
  rewards!: DailyRewardItem[];

  /** Day 7 is typically flagged as "Big Reward" in the UI. */
  @Prop({ type: Boolean, default: false })
  isBigReward!: boolean;
}
const DailyRewardDaySchema = SchemaFactory.createForClass(DailyRewardDay);

/**
 * The whole 7-day cycle config. There is exactly one document keyed by
 * `_id: "default"`. Admin edits replace the entire `days` array; we bump
 * `version` on every save so user state can detect cycle resets.
 */
@Schema({
  collection: 'daily_reward_config',
  timestamps: true,
  toJSON: {
    transform: (_doc, ret: Record<string, any>) => {
      ret.id = ret._id;
      delete ret._id;
      delete ret.__v;
      return ret;
    },
  },
})
export class DailyRewardConfig {
  @Prop({ type: String, required: true })
  _id!: string; // always "default"

  @Prop({ type: Number, default: 1 })
  version!: number;

  @Prop({ type: [DailyRewardDaySchema], default: [] })
  days!: DailyRewardDay[];

  @Prop({ type: Boolean, default: true })
  active!: boolean;
}

export const DailyRewardConfigSchema = SchemaFactory.createForClass(DailyRewardConfig);
