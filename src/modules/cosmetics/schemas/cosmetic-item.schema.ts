import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type CosmeticItemDocument = HydratedDocument<CosmeticItem>;

/**
 * The kinds of cosmetics in the catalog. New types can be added at any time —
 * they're just labels that group items in the store and on user profiles.
 *
 * Anything that's a wearable/displayable cosmetic lives here, regardless of
 * whether it's earned via SVIP or sold in the store.
 */
export enum CosmeticType {
  // Visible everywhere — store-friendly categories
  FRAME = 'frame',
  VEHICLE = 'vehicle',
  THEME = 'theme',
  RING = 'ring',
  // SVIP identity items
  MEDAL = 'medal',
  TITLE = 'title',
  ROOM_CARD = 'room_card',
  ROOM_CHAT_BUBBLE = 'room_chat_bubble',
  ROOM_LIST_BORDER = 'room_list_border',
  MIC_WAVE = 'mic_wave',
  MIC_SKIN = 'mic_skin',
  SPECIAL_GIFT_NOTIFICATION = 'special_gift_notification',
  PROFILE_BACKGROUND = 'profile_background',
  LUDO_DICE_SKIN = 'ludo_dice_skin',
  DYNAMIC_AVATAR = 'dynamic_avatar',
}

export enum CosmeticAssetType {
  /** PNG/JPG/WEBP — already covered by previewUrl. */
  IMAGE = 'image',
  /** Tencent SVGA binary, uploaded as Cloudinary "raw". */
  SVGA = 'svga',
  /** Lottie / Bodymovin JSON, uploaded as "raw". */
  LOTTIE = 'lottie',
  /** Short MP4 / WebM clip, uploaded as "video". */
  MP4 = 'mp4',
  /** No animated asset, just preview. */
  NONE = 'none',
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
export class CosmeticItem {
  @Prop({ type: LocalizedStringSchema, required: true })
  name!: LocalizedString;

  /** Unique short code, e.g. "FRAME_PINK_FEATHER". */
  @Prop({ type: String, required: true, unique: true, uppercase: true, trim: true })
  code!: string;

  @Prop({ type: LocalizedStringSchema, default: () => ({ en: '', bn: '' }) })
  description!: LocalizedString;

  @Prop({ type: String, enum: CosmeticType, required: true, index: true })
  type!: CosmeticType;

  /** Static preview (PNG/JPG/WebP) — shown in admin lists, store cards, inventory. */
  @Prop({ type: String, default: '' })
  previewUrl!: string;

  @Prop({ type: String, default: '' })
  previewPublicId!: string;

  /** Animated asset URL (SVGA/Lottie/MP4). Empty if NONE. */
  @Prop({ type: String, default: '' })
  assetUrl!: string;

  @Prop({ type: String, default: '' })
  assetPublicId!: string;

  @Prop({ type: String, enum: CosmeticAssetType, default: CosmeticAssetType.NONE })
  assetType!: CosmeticAssetType;

  /** 1–5 stars — surfaced as the star row on store cards. */
  @Prop({ type: Number, default: 3, min: 1, max: 5 })
  rarity!: number;

  @Prop({ type: Boolean, default: true, index: true })
  active!: boolean;

  @Prop({ type: Number, default: 0, index: true })
  sortOrder!: number;

  @Prop({ type: Types.ObjectId, ref: 'AdminUser', default: null })
  createdBy?: Types.ObjectId | null;
}

export const CosmeticItemSchema = SchemaFactory.createForClass(CosmeticItem);
CosmeticItemSchema.index({ code: 1 }, { unique: true });
CosmeticItemSchema.index({ type: 1, active: 1, sortOrder: -1 });
