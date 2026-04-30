import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type UserDocument = HydratedDocument<User>;

export enum UserStatus {
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
  BANNED = 'banned',
  DELETED = 'deleted',
}

export enum AuthProvider {
  EMAIL = 'email',
  PHONE = 'phone',
  GOOGLE = 'google',
  FACEBOOK = 'facebook',
  APPLE = 'apple',
}

export enum HostTier {
  TRAINEE = 'trainee',
  BRONZE = 'bronze',
  SILVER = 'silver',
  GOLD = 'gold',
  PLATINUM = 'platinum',
  DIAMOND = 'diamond',
}

@Schema({ _id: false })
export class HostProfile {
  @Prop({ type: String, enum: HostTier, default: HostTier.TRAINEE })
  tier!: HostTier;

  @Prop({ type: Date, default: () => new Date() })
  approvedAt!: Date;

  @Prop({ type: Types.ObjectId, default: null })
  approvedBy?: Types.ObjectId | null;

  /** Agency that this host is signed with, if any. */
  @Prop({ type: Types.ObjectId, default: null })
  agencyId?: Types.ObjectId | null;

  @Prop({ type: Number, default: 0 })
  totalDiamondsEarned!: number;

  @Prop({ type: Number, default: 0 })
  streamHours!: number;
}

export const HostProfileSchema = SchemaFactory.createForClass(HostProfile);

@Schema({
  timestamps: true,
  toJSON: {
    virtuals: true,
    transform: (_doc, ret: Record<string, any>) => {
      ret.id = ret._id?.toString();
      delete ret._id;
      delete ret.__v;
      delete ret.passwordHash;
      return ret;
    },
  },
})
export class User {
  @Prop({ type: String, lowercase: true, trim: true, sparse: true, unique: true })
  email?: string;

  @Prop({ type: String, trim: true, sparse: true, unique: true })
  phone?: string;

  @Prop({ type: String, lowercase: true, trim: true, sparse: true, unique: true })
  username?: string;

  @Prop({ type: String, select: false })
  passwordHash?: string;

  @Prop({ type: [String], enum: AuthProvider, default: [] })
  providers!: AuthProvider[];

  /** Google subject id (the `sub` claim of the verified ID token). */
  @Prop({ type: String, default: null, sparse: true, index: true })
  googleId?: string | null;

  /** Facebook user id (when we add Facebook OAuth). */
  @Prop({ type: String, default: null, sparse: true, index: true })
  facebookId?: string | null;

  /** Apple sub id (for Sign In with Apple). */
  @Prop({ type: String, default: null, sparse: true, index: true })
  appleId?: string | null;

  @Prop({ type: String, default: '' })
  displayName!: string;

  @Prop({ type: String, default: '' })
  avatarUrl!: string;

  /** Cloudinary public_id for the avatar — needed to overwrite/delete it later. */
  @Prop({ type: String, default: '' })
  avatarPublicId!: string;

  @Prop({ type: String, default: '' })
  coverPhotoUrl!: string;

  @Prop({ type: String, default: '' })
  coverPhotoPublicId!: string;

  @Prop({ type: String, default: '' })
  bio!: string;

  @Prop({ type: String, default: 'en' })
  language!: string;

  @Prop({ type: String, default: 'BD' })
  country!: string;

  @Prop({ type: String, enum: UserStatus, default: UserStatus.ACTIVE })
  status!: UserStatus;

  @Prop({ type: String, default: '' })
  banReason!: string;

  @Prop({ type: Date, default: null })
  bannedAt?: Date | null;

  @Prop({ type: Types.ObjectId, default: null })
  bannedBy?: Types.ObjectId | null;

  @Prop({ type: Boolean, default: false })
  emailVerified!: boolean;

  @Prop({ type: Boolean, default: false })
  phoneVerified!: boolean;

  @Prop({ type: Date })
  lastLoginAt?: Date;

  @Prop({ type: Number, default: 1 })
  level!: number;

  @Prop({ type: Number, default: 0 })
  xp!: number;

  // ------- Host capability (user becomes a broadcaster) -------

  @Prop({ type: Boolean, default: false, index: true })
  isHost!: boolean;

  @Prop({ type: HostProfileSchema, default: null })
  hostProfile?: HostProfile | null;

  // ------- Admin linkage (if user was promoted to agency/reseller) -------

  @Prop({ type: Types.ObjectId, ref: 'AdminUser', default: null, index: true })
  linkedAdminId?: Types.ObjectId | null;
}

export const UserSchema = SchemaFactory.createForClass(User);

UserSchema.index({ email: 1 }, { unique: true, sparse: true });
UserSchema.index({ phone: 1 }, { unique: true, sparse: true });
UserSchema.index({ username: 1 }, { unique: true, sparse: true });
UserSchema.index({ createdAt: -1 });
UserSchema.index({ status: 1 });
UserSchema.index({ isHost: 1, status: 1 });
