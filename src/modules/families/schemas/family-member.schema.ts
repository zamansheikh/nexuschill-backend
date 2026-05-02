import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type FamilyMemberDocument = HydratedDocument<FamilyMember>;

export enum FamilyMemberRole {
  LEADER = 'leader',
  CO_LEADER = 'co_leader',
  MEMBER = 'member',
}

export enum FamilyMemberStatus {
  /** Confirmed family member — counted in memberCount + leaderboards. */
  ACTIVE = 'active',
  /**
   * Pending review (only for joinMode === REVIEW). Not counted toward
   * memberCount; the leader / co-leaders see these in a "requests" tab.
   */
  PENDING = 'pending',
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
export class FamilyMember {
  @Prop({ type: Types.ObjectId, ref: 'Family', required: true, index: true })
  familyId!: Types.ObjectId;

  /**
   * `userId` is unique across all FamilyMember docs — a user can hold at
   * most one membership at any time, whether ACTIVE or PENDING. Leaving /
   * being kicked deletes the doc so the user is free to apply elsewhere.
   */
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, unique: true })
  userId!: Types.ObjectId;

  @Prop({ type: String, enum: FamilyMemberRole, default: FamilyMemberRole.MEMBER })
  role!: FamilyMemberRole;

  @Prop({ type: String, enum: FamilyMemberStatus, default: FamilyMemberStatus.ACTIVE, index: true })
  status!: FamilyMemberStatus;

  /** Snapshot for "since" UI. Distinct from createdAt only after migrations. */
  @Prop({ type: Date, default: () => new Date() })
  joinedAt!: Date;
}

export const FamilyMemberSchema = SchemaFactory.createForClass(FamilyMember);

// `userId` is already indexed via `@Prop({ unique: true })`.
// "Members of family X" — most-called query.
FamilyMemberSchema.index({ familyId: 1, status: 1, role: 1 });
