import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type UserReportDocument = HydratedDocument<UserReport>;

/**
 * What the user is reporting. Keep this list short and actionable —
 * mobile UI maps each value to a friendly label. Adding a new reason
 * here ALSO needs the mobile picker to be updated; old values can
 * stay forever (historic reports keep their original reason).
 */
export enum ReportReason {
  SPAM = 'spam',
  HARASSMENT = 'harassment',
  HATE_SPEECH = 'hate_speech',
  SEXUAL_CONTENT = 'sexual_content',
  CHILD_SAFETY = 'child_safety',
  VIOLENCE = 'violence',
  IMPERSONATION = 'impersonation',
  SCAM_OR_FRAUD = 'scam_or_fraud',
  SELF_HARM = 'self_harm',
  OTHER = 'other',
}

/** What kind of thing is being reported. Right now we ship USER and
 *  ROOM — message-level reports can be modelled by setting `targetType
 *  = 'message'` later, with `targetId` pointing at the message id and
 *  `roomId` recorded in `meta` for context. */
export enum ReportTargetType {
  USER = 'user',
  ROOM = 'room',
  MOMENT = 'moment',
  MESSAGE = 'message',
}

/** Admin lifecycle — closed reports stay searchable for audit. */
export enum ReportStatus {
  PENDING = 'pending',
  REVIEWED = 'reviewed',
  ACTIONED = 'actioned',
  DISMISSED = 'dismissed',
}

/**
 * One row per report submission. Reporters cannot retract a report;
 * admins resolve it via the admin panel. The CHILD_SAFETY reason is
 * indexed separately so the moderation queue can default to that
 * filter — required by Google Play's Child Safety Standards policy
 * (priority review pathway).
 */
@Schema({
  timestamps: true,
  toJSON: {
    transform: (_doc, ret: Record<string, any>) => {
      ret.id = ret._id?.toString();
      ret.reporterId = ret.reporterId?.toString?.() ?? ret.reporterId;
      ret.targetUserId = ret.targetUserId?.toString?.() ?? ret.targetUserId;
      ret.resolvedBy = ret.resolvedBy?.toString?.() ?? ret.resolvedBy;
      delete ret._id;
      delete ret.__v;
      return ret;
    },
  },
})
export class UserReport {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  reporterId!: Types.ObjectId;

  @Prop({
    type: String,
    enum: ReportTargetType,
    required: true,
    index: true,
  })
  targetType!: ReportTargetType;

  /** Stringified id of the target object (user / room / moment / message).
   *  Stored as string so the reports module doesn't have to know about
   *  every domain's ObjectId vs custom id format. */
  @Prop({ type: String, required: true, index: true })
  targetId!: string;

  /** Convenience pointer when the report is *about a user* — populated
   *  for `targetType: USER`, and also set when a room / moment / message
   *  report can resolve back to a single owning user. Lets the admin
   *  panel sort and group by the offending user without joining. */
  @Prop({ type: Types.ObjectId, ref: 'User', default: null, index: true })
  targetUserId?: Types.ObjectId | null;

  @Prop({ type: String, enum: ReportReason, required: true, index: true })
  reason!: ReportReason;

  /** Free-form context from the reporter. Capped server-side to keep
   *  index pages lean. */
  @Prop({ type: String, default: '', maxlength: 1000 })
  description!: string;

  /**
   * Optional structured payload — caller can attach the in-app screen
   * (e.g. roomId for a chat-message report) so admins land with full
   * context. Schema-less because new surfaces will tack on new fields
   * over time.
   */
  @Prop({ type: Object, default: () => ({}) })
  meta!: Record<string, unknown>;

  @Prop({
    type: String,
    enum: ReportStatus,
    default: ReportStatus.PENDING,
    index: true,
  })
  status!: ReportStatus;

  @Prop({ type: String, default: '' })
  adminNote!: string;

  @Prop({ type: Date, default: null })
  resolvedAt?: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'AdminUser', default: null })
  resolvedBy?: Types.ObjectId | null;
}

export const UserReportSchema = SchemaFactory.createForClass(UserReport);
// Most-recent reports first — the moderation queue's default sort.
UserReportSchema.index({ createdAt: -1 });
// Status + createdAt covers the "pending only, newest first" filter
// hit on every admin page load.
UserReportSchema.index({ status: 1, createdAt: -1 });
// Child-safety priority pathway — used as a default tab in admin UI.
UserReportSchema.index({ reason: 1, status: 1, createdAt: -1 });
