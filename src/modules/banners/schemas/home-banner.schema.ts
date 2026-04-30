import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type HomeBannerDocument = HydratedDocument<HomeBanner>;

/**
 * Where tapping a linked home banner sends the user. Each kind takes a
 * matching identifier in `linkValue`:
 *
 *   • route        → an in-app go_router path (e.g. '/svip', '/store')
 *   • room         → a live room id
 *   • user         → a user numericId or _id
 *   • web          → an https URL opened in the in-app browser
 *   • event        → an event/promo id (handled inside the app)
 */
export enum BannerLinkKind {
  NONE = 'none',
  ROUTE = 'route',
  ROOM = 'room',
  USER = 'user',
  WEB = 'web',
  EVENT = 'event',
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
export class HomeBanner {
  /** Short label for admin lists — not necessarily user-visible. */
  @Prop({ type: String, required: true, trim: true })
  title!: string;

  @Prop({ type: String, default: '' })
  subtitle!: string;

  @Prop({ type: String, required: true })
  imageUrl!: string;

  @Prop({ type: String, default: '' })
  imagePublicId!: string;

  /** "none" = pure visual banner, no tap. Otherwise see BannerLinkKind. */
  @Prop({ type: String, enum: BannerLinkKind, default: BannerLinkKind.NONE })
  linkKind!: BannerLinkKind;

  /** Interpreted by the mobile app based on linkKind. */
  @Prop({ type: String, default: '' })
  linkValue!: string;

  @Prop({ type: Number, default: 0, index: true })
  sortOrder!: number;

  @Prop({ type: Boolean, default: true, index: true })
  active!: boolean;

  @Prop({ type: Date, default: null })
  startDate?: Date | null;

  @Prop({ type: Date, default: null })
  endDate?: Date | null;

  /** ISO-2 country codes — empty = all regions. */
  @Prop({ type: [String], default: [] })
  countries!: string[];

  @Prop({ type: Types.ObjectId, ref: 'AdminUser', default: null })
  createdBy?: Types.ObjectId | null;
}

export const HomeBannerSchema = SchemaFactory.createForClass(HomeBanner);
HomeBannerSchema.index({ active: 1, sortOrder: -1, createdAt: -1 });
