import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

import { LuckyBagDistributionMode } from './lucky-bag.schema';

export type LuckyBagConfigDocument = HydratedDocument<LuckyBagConfig>;

/**
 * One reward tier — bound to a specific slot count. The `percentages`
 * array MUST be the same length as `slotCount` and sum to 1.0 (within a
 * small epsilon). The service validates on update.
 *
 * The "with commission" table from the design note is just the same
 * percentages × (1 − commissionRate). We only store the base (without
 * commission) here so admins maintain a single source of truth.
 */
@Schema({ _id: false })
export class LuckyBagTier {
  @Prop({ type: Number, required: true, min: 1 })
  slotCount!: number;

  @Prop({ type: [Number], required: true })
  percentages!: number[];
}

export const LuckyBagTierSchema = SchemaFactory.createForClass(LuckyBagTier);

/**
 * Singleton platform config for Lucky Bag. Lazy-upserted on first read
 * with the defaults pulled from `docs/test.txt`.
 *
 * - `coinPresets` is the menu the sender picks from in the composer.
 * - `tiers[].slotCount` is the menu of allowed recipient counts. A bag
 *   can only be created at a slot count that has a matching tier row,
 *   so the random distribution + the fixed-tier distribution always
 *   share a common menu.
 * - `commissionRate` ∈ [0, 1]. Multiplied at distribution time when
 *   `applyCommissionByDefault` is true.
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
export class LuckyBagConfig {
  @Prop({ type: String, required: true, unique: true, default: 'singleton' })
  key!: string;

  /** Master kill switch — when false, create endpoints reject. */
  @Prop({ type: Boolean, default: true })
  enabled!: boolean;

  /** 0..1 — what fraction of `totalCoins` the platform retains. */
  @Prop({ type: Number, default: 0.25, min: 0, max: 1 })
  commissionRate!: number;

  /** Default behaviour when sender doesn't override. v1 always uses this. */
  @Prop({ type: Boolean, default: true })
  applyCommissionByDefault!: boolean;

  @Prop({ type: [Number], default: [60000, 150000, 210000, 300000, 600000] })
  coinPresets!: number[];

  @Prop({ type: [LuckyBagTierSchema], default: [] })
  tiers!: LuckyBagTier[];

  /**
   * When true, the mobile composer shows the random/fixed-tier picker
   * and the user chooses. When false, the picker is hidden and the
   * server forces `composerDefaultDistributionMode` regardless of what
   * the client sends.
   */
  @Prop({ type: Boolean, default: true })
  composerShowDistributionMode!: boolean;

  /**
   * The mode used when the picker is hidden, AND the pre-selected mode
   * shown when it's visible. Server enforces this for hidden-picker
   * configs even if the client tries to override.
   */
  @Prop({
    type: String,
    enum: LuckyBagDistributionMode,
    default: LuckyBagDistributionMode.RANDOM,
  })
  composerDefaultDistributionMode!: LuckyBagDistributionMode;
}

export const LuckyBagConfigSchema = SchemaFactory.createForClass(LuckyBagConfig);
