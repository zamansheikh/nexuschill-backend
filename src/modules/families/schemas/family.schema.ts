import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type FamilyDocument = HydratedDocument<Family>;

export enum FamilyStatus {
  ACTIVE = 'active',
  /** Admin-set: no new members, no edits, hidden from search. */
  FROZEN = 'frozen',
  /** Terminal: user-quit-down auto-disband or admin force-disband. */
  DISBANDED = 'disbanded',
}

export enum FamilyJoinMode {
  /** Leader / co-leader must approve each request. (Default — matches the create-family screen.) */
  REVIEW = 'review',
  /** Anyone meeting the level requirement joins immediately. */
  OPEN = 'open',
  /** Only leader / co-leader can issue invites; no public join button. */
  INVITE_ONLY = 'invite_only',
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
export class Family {
  /** 7-digit public ID (1_000_000+). Mirrors User.numericId / Agency.numericId. */
  @Prop({ type: Number, unique: true, sparse: true, index: true })
  numericId?: number;

  /** Display name. Spec caps at 15 chars (per the mobile create-family screen). */
  @Prop({ type: String, required: true, trim: true, maxlength: 15 })
  name!: string;

  @Prop({ type: String, default: '' })
  coverUrl!: string;

  /** Cloudinary public_id retained so we can replace/delete the asset cleanly. */
  @Prop({ type: String, default: '' })
  coverPublicId!: string;

  /** Pinned message shown at the top of the family page. ≤200 chars per the UI. */
  @Prop({ type: String, default: '', maxlength: 200 })
  notification!: string;

  @Prop({ type: String, enum: FamilyJoinMode, default: FamilyJoinMode.REVIEW })
  joinMode!: FamilyJoinMode;

  /** Minimum user level required to apply (the screen shows "Lv.0" by default). */
  @Prop({ type: Number, default: 0, min: 0 })
  joinLevelRequirement!: number;

  /** Phase-1 stub. XP/level progression engine lands later. Visible in badge UI. */
  @Prop({ type: Number, default: 1, min: 1 })
  level!: number;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  leaderId!: Types.ObjectId;

  /** Up to a small handful of co-leaders; review/kick rights delegate here. */
  @Prop({ type: [{ type: Types.ObjectId, ref: 'User' }], default: [] })
  coLeaderIds!: Types.ObjectId[];

  /** Denormalized for cheap leaderboards + the auto-disband sweeper. */
  @Prop({ type: Number, default: 1, min: 0 })
  memberCount!: number;

  @Prop({ type: String, enum: FamilyStatus, default: FamilyStatus.ACTIVE, index: true })
  status!: FamilyStatus;

  /**
   * Set the moment memberCount drops to 1, cleared the moment it climbs back.
   * The auto-disband cron disbands when `Date.now() - soloSince >= 7 days`.
   */
  @Prop({ type: Date, default: null, index: true })
  soloSince?: Date | null;

  /**
   * Last time the leader changed the name. Spec restricts edits to once per
   * 30 days; service checks this before allowing a rename.
   */
  @Prop({ type: Date, default: null })
  lastNameChangedAt?: Date | null;

  @Prop({ type: Date, default: null })
  lastCoverChangedAt?: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy!: Types.ObjectId;

  /**
   * Coins paid at creation time (0 if SVIP4+ created for free). Recorded on
   * the family doc itself for cheap audit trail; the canonical record is the
   * Transaction ledger entry of type `family_create_fee`.
   */
  @Prop({ type: Number, default: 0 })
  creationFeePaid!: number;
}

export const FamilySchema = SchemaFactory.createForClass(Family);

// `numericId` is already indexed via `@Prop({ unique: true })`.
// Lookup by leader is common (e.g., "do I already lead a family?").
FamilySchema.index({ leaderId: 1 }, { unique: true, partialFilterExpression: { status: { $in: ['active', 'frozen'] } } });
// Search by name (case-insensitive in queries via $regex).
FamilySchema.index({ name: 1 });
FamilySchema.index({ status: 1, memberCount: -1 });
