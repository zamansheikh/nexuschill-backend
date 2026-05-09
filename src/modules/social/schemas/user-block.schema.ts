import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type UserBlockDocument = HydratedDocument<UserBlock>;

/**
 * Directed block relationship: `blockerId` no longer wishes to interact
 * with `blockedId`. One row per directed pair — mutual blocks would be
 * two rows but in practice only one direction is needed for filtering
 * since blocks are enforced from the *blocker's* perspective.
 *
 * Filtering policy across the platform (enforced wherever a user list
 * surfaces — search, followers/following/visitors, moments feed, chat
 * threads):
 *   • A blocked user does NOT appear in the blocker's lists.
 *   • The blocker does NOT appear in the blocked user's lists either —
 *     the experience is symmetric so neither side gets the awkward
 *     "they blocked me but I can still see them" state.
 *   • Direct DM is gated when either party blocked the other.
 *   • Following relationships persist in the data model but are masked
 *     in the UI (so unblocking restores the prior follow). Use
 *     `isMutuallyBlocked()` to test for either-direction blocks.
 *
 * Required by Google Play's User Safety policy for any app with UGC
 * and social interaction.
 */
@Schema({
  timestamps: true,
  toJSON: {
    transform: (_doc, ret: Record<string, any>) => {
      ret.id = ret._id?.toString();
      ret.blockerId = ret.blockerId?.toString?.() ?? ret.blockerId;
      ret.blockedId = ret.blockedId?.toString?.() ?? ret.blockedId;
      delete ret._id;
      delete ret.__v;
      return ret;
    },
  },
})
export class UserBlock {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  blockerId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  blockedId!: Types.ObjectId;
}

export const UserBlockSchema = SchemaFactory.createForClass(UserBlock);
// One row per directed pair; insert is idempotent because of this.
UserBlockSchema.index({ blockerId: 1, blockedId: 1 }, { unique: true });
// Reverse-direction lookup: "is X blocked by anyone?" — used by
// services filtering content from blockers (so the blocked user can't
// see the blocker either).
UserBlockSchema.index({ blockedId: 1, blockerId: 1 });
