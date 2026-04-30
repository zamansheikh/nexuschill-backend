import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type AgoraConfigDocument = HydratedDocument<AgoraConfig>;

/**
 * Single-doc collection (`_id: "default"`) holding the platform's Agora
 * credentials. Stored in DB so admins can rotate keys without redeploy.
 *
 * Security:
 *   • The `appCertificate` is the server-only secret; the admin GET
 *     endpoint masks it before returning.
 *   • Token-mint endpoints read from this doc on every call so a freshly
 *     saved certificate takes effect immediately.
 */
@Schema({
  collection: 'agora_config',
  timestamps: true,
  toJSON: {
    transform: (_doc, ret: Record<string, any>) => {
      ret.id = ret._id;
      delete ret.__v;
      return ret;
    },
  },
})
export class AgoraConfig {
  @Prop({ type: String, required: true })
  _id!: string; // always "default"

  @Prop({ type: String, default: '' })
  appId!: string;

  /** Sensitive — never returned via admin GET in plain. */
  @Prop({ type: String, default: '' })
  appCertificate!: string;

  /** Default RTC token validity in seconds. Used when client omits it. */
  @Prop({ type: Number, default: 3600, min: 60 })
  defaultExpireSeconds!: number;

  /** When false, both /agora/rtc-token and /agora/rtm-token return 503. */
  @Prop({ type: Boolean, default: true })
  enabled!: boolean;

  @Prop({ type: Types.ObjectId, ref: 'AdminUser', default: null })
  updatedBy?: Types.ObjectId | null;
}

export const AgoraConfigSchema = SchemaFactory.createForClass(AgoraConfig);
