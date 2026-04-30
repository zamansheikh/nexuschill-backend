import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type GiftDocument = HydratedDocument<Gift>;

export enum GiftCategory {
  BASIC = 'basic',
  PREMIUM = 'premium',
  LEGENDARY = 'legendary',
  LIMITED = 'limited',
}

@Schema({ _id: false })
export class LocalizedString {
  @Prop({ type: String, default: '' })
  en!: string;

  @Prop({ type: String, default: '' })
  bn!: string;
}

const LocalizedStringSchema = SchemaFactory.createForClass(LocalizedString);

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
export class Gift {
  @Prop({ type: LocalizedStringSchema, required: true })
  name!: LocalizedString;

  /** Unique short code, e.g. "ROSE", "DRAGON". */
  @Prop({ type: String, required: true, unique: true, uppercase: true, trim: true })
  code!: string;

  @Prop({ type: LocalizedStringSchema, default: () => ({ en: '', bn: '' }) })
  description!: LocalizedString;

  @Prop({ type: String, enum: GiftCategory, default: GiftCategory.BASIC, index: true })
  category!: GiftCategory;

  // ----- Pricing -----

  @Prop({ type: Number, required: true, min: 1 })
  priceCoins!: number;

  /** Beans the receiver gets when this gift is sent (typically priceCoins * 0.5). */
  @Prop({ type: Number, required: true, min: 0 })
  beanReward!: number;

  // ----- Assets -----

  @Prop({ type: String, default: '' })
  thumbnailUrl!: string;

  @Prop({ type: String, default: '' })
  animationUrl!: string;

  @Prop({ type: String, default: '' })
  soundUrl!: string;

  @Prop({ type: Number, default: 3000 })
  durationMs!: number;

  // ----- Availability -----

  @Prop({ type: Boolean, default: true, index: true })
  active!: boolean;

  @Prop({ type: Date, default: null })
  startDate?: Date | null;

  @Prop({ type: Date, default: null })
  endDate?: Date | null;

  @Prop({ type: Boolean, default: false })
  vipOnly!: boolean;

  @Prop({ type: Boolean, default: false })
  svipOnly!: boolean;

  /** Empty list = available everywhere. Otherwise only these ISO-2 country codes. */
  @Prop({ type: [String], default: [] })
  countries!: string[];

  // ----- Combo / display -----

  @Prop({ type: [Number], default: [1, 10, 66, 188, 520, 1314] })
  comboMultipliers!: number[];

  @Prop({ type: Number, default: 0, index: true })
  sortOrder!: number;

  @Prop({ type: Boolean, default: false, index: true })
  featured!: boolean;

  // ----- Counters -----

  @Prop({ type: Number, default: 0 })
  totalSent!: number;

  @Prop({ type: Number, default: 0 })
  totalCoinsCollected!: number;

  // ----- Audit -----

  @Prop({ type: Types.ObjectId, ref: 'AdminUser', default: null })
  createdBy?: Types.ObjectId | null;
}

export const GiftSchema = SchemaFactory.createForClass(Gift);
GiftSchema.index({ code: 1 }, { unique: true });
GiftSchema.index({ active: 1, sortOrder: -1, priceCoins: 1 });
GiftSchema.index({ featured: 1, active: 1 });
