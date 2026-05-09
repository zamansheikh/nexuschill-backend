import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { HonorsService } from '../honors/honors.service';
import { HonorMetric } from '../honors/schemas/honor-item.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { Follow, FollowDocument } from './schemas/follow.schema';
import {
  ProfileVisit,
  ProfileVisitDocument,
} from './schemas/profile-visit.schema';
import { UserBlock, UserBlockDocument } from './schemas/user-block.schema';

export interface UserListView {
  id: string;
  numericId: number | null;
  displayName: string;
  username: string | null;
  avatarUrl: string;
  level: number;
  country: string;
  /** Whether the *caller* is currently following this user. Only set
   *  when the list is fetched by a logged-in user. */
  isFollowing: boolean;
}

/**
 * Single home for the social graph (Follow) and profile-view tracking
 * (ProfileVisit). Kept as one module because both touch the same
 * `User` collection (counts denormalize) and the failure modes are
 * adjacent — neither is allowed to crash the underlying user lookup.
 *
 * Counts strategy:
 *   • Followers / following — denormalized on the `User` doc as
 *     `followersCount` / `followingCount`. Bumped atomically with
 *     each Follow row insert / delete via `$inc`. Public profile
 *     reads them in O(1).
 *   • Visitors — NOT denormalized. The visitors-list endpoint counts
 *     unique rows on demand; the "Me" tab is the only common reader
 *     and a `countDocuments` on an indexed field is cheap.
 *
 * Self-action guards (a user can't follow / visit themselves) live
 * here at the service layer; the controller is intentionally thin.
 */
@Injectable()
export class SocialService {
  private readonly logger = new Logger(SocialService.name);

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Follow.name) private readonly followModel: Model<FollowDocument>,
    @InjectModel(ProfileVisit.name)
    private readonly visitModel: Model<ProfileVisitDocument>,
    @InjectModel(UserBlock.name)
    private readonly blockModel: Model<UserBlockDocument>,
    private readonly honors: HonorsService,
  ) {}

  // ============== Follow / Unfollow ==============

  /**
   * Idempotent follow. Returns `created: true` only on the first
   * insert; subsequent calls are silent no-ops so the mobile button
   * doesn't have to track local state across navigations.
   */
  async follow(
    followerId: string,
    followeeId: string,
  ): Promise<{ created: boolean }> {
    if (!Types.ObjectId.isValid(followerId) || !Types.ObjectId.isValid(followeeId)) {
      throw new BadRequestException({ code: 'INVALID_ID', message: 'Invalid id' });
    }
    if (followerId === followeeId) {
      throw new BadRequestException({
        code: 'CANNOT_FOLLOW_SELF',
        message: 'You cannot follow yourself',
      });
    }
    const followerOid = new Types.ObjectId(followerId);
    const followeeOid = new Types.ObjectId(followeeId);

    const targetExists = await this.userModel
      .exists({ _id: followeeOid })
      .exec();
    if (!targetExists) {
      throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User not found' });
    }

    try {
      await this.followModel.create({
        followerId: followerOid,
        followeeId: followeeOid,
      });
    } catch (err: any) {
      // Duplicate key — already following. Idempotent.
      if (err?.code === 11000) return { created: false };
      throw err;
    }

    // Bump both counter sides atomically. Run in parallel — these
    // are independent docs and no FK between them.
    await Promise.all([
      this.userModel
        .updateOne({ _id: followerOid }, { $inc: { followingCount: 1 } })
        .exec(),
      this.userModel
        .updateOne({ _id: followeeOid }, { $inc: { followersCount: 1 } })
        .exec(),
    ]);
    // Honor evaluation hooks — fire-and-forget. The follower's
    // FOLLOWING count just bumped; the followee's FOLLOWERS count
    // just bumped. Either may unlock a rule-based medal.
    void this.honors
      .evaluateUser(followerId, HonorMetric.FOLLOWING)
      .catch(() => {/* swallow */});
    void this.honors
      .evaluateUser(followeeId, HonorMetric.FOLLOWERS)
      .catch(() => {/* swallow */});
    return { created: true };
  }

  /**
   * Idempotent unfollow. `removed: false` when there was nothing to
   * remove (the user wasn't following the target) so the client can
   * skip its local state flip without an error round-trip.
   */
  async unfollow(
    followerId: string,
    followeeId: string,
  ): Promise<{ removed: boolean }> {
    if (!Types.ObjectId.isValid(followerId) || !Types.ObjectId.isValid(followeeId)) {
      return { removed: false };
    }
    const followerOid = new Types.ObjectId(followerId);
    const followeeOid = new Types.ObjectId(followeeId);
    const res = await this.followModel
      .deleteOne({ followerId: followerOid, followeeId: followeeOid })
      .exec();
    if (res.deletedCount === 0) return { removed: false };

    // Decrement matching counters. `$max: 0` clamp would be ideal but
    // Mongo doesn't have one — counters can race-go negative under
    // concurrent unfollows of the same user; this is acceptable for
    // a display-only number and self-corrects on next denorm rebuild.
    await Promise.all([
      this.userModel
        .updateOne({ _id: followerOid }, { $inc: { followingCount: -1 } })
        .exec(),
      this.userModel
        .updateOne({ _id: followeeOid }, { $inc: { followersCount: -1 } })
        .exec(),
    ]);
    return { removed: true };
  }

  /** "Does [followerId] follow [followeeId]?" — used to hydrate the
   *  `isFollowing` flag on a public profile fetch. Returns false for
   *  the self-case so the UI can hide the follow button. */
  async isFollowing(followerId: string, followeeId: string): Promise<boolean> {
    if (
      !Types.ObjectId.isValid(followerId) ||
      !Types.ObjectId.isValid(followeeId) ||
      followerId === followeeId
    ) {
      return false;
    }
    const exists = await this.followModel
      .exists({
        followerId: new Types.ObjectId(followerId),
        followeeId: new Types.ObjectId(followeeId),
      })
      .exec();
    return Boolean(exists);
  }

  // ============== Lists ==============

  async listFollowers(
    targetUserId: string,
    callerUserId: string | null,
    params: { page?: number; limit?: number },
  ) {
    return this.listEdges('followers', targetUserId, callerUserId, params);
  }

  async listFollowing(
    targetUserId: string,
    callerUserId: string | null,
    params: { page?: number; limit?: number },
  ) {
    return this.listEdges('following', targetUserId, callerUserId, params);
  }

  /** Internal — branch picks the directional index. Pagination lives
   *  here too so both list endpoints share the same shape. */
  private async listEdges(
    direction: 'followers' | 'following',
    targetUserId: string,
    callerUserId: string | null,
    params: { page?: number; limit?: number },
  ) {
    if (!Types.ObjectId.isValid(targetUserId)) {
      throw new BadRequestException({ code: 'INVALID_ID', message: 'Invalid id' });
    }
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(50, Math.max(1, params.limit ?? 20));
    const skip = (page - 1) * limit;
    const targetOid = new Types.ObjectId(targetUserId);

    const filter =
      direction === 'followers'
        ? { followeeId: targetOid }
        : { followerId: targetOid };
    const userField = direction === 'followers' ? 'followerId' : 'followeeId';

    const [edges, total] = await Promise.all([
      this.followModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate(userField, 'username displayName avatarUrl numericId level country')
        .exec(),
      this.followModel.countDocuments(filter).exec(),
    ]);

    const items = await this.hydrateUsers(
      edges
        .map((e) => (e as any)[userField])
        .filter((u: unknown) => u != null),
      callerUserId,
    );
    return { items, page, limit, total };
  }

  // ============== Visitors ==============

  /**
   * Record (or refresh) a profile visit. No-op for self-views since
   * those would just clutter the user's own visitors list. Idempotent
   * — a returning visitor just bumps `lastVisitedAt` so the visitors
   * list re-orders to "most recently seen first".
   */
  async recordVisit(visitorId: string, visitedUserId: string): Promise<void> {
    if (
      !Types.ObjectId.isValid(visitorId) ||
      !Types.ObjectId.isValid(visitedUserId) ||
      visitorId === visitedUserId
    ) {
      return;
    }
    try {
      await this.visitModel
        .updateOne(
          {
            visitorId: new Types.ObjectId(visitorId),
            visitedUserId: new Types.ObjectId(visitedUserId),
          },
          { $set: { lastVisitedAt: new Date() } },
          { upsert: true },
        )
        .exec();
    } catch (err) {
      // Visit tracking is best-effort — a failure here should never
      // surface to the user opening a profile.
      this.logger.warn(`recordVisit failed: ${(err as Error).message}`);
    }
  }

  async listVisitors(
    targetUserId: string,
    callerUserId: string | null,
    params: { page?: number; limit?: number },
  ) {
    if (!Types.ObjectId.isValid(targetUserId)) {
      throw new BadRequestException({ code: 'INVALID_ID', message: 'Invalid id' });
    }
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(50, Math.max(1, params.limit ?? 20));
    const skip = (page - 1) * limit;
    const targetOid = new Types.ObjectId(targetUserId);

    const [visits, total] = await Promise.all([
      this.visitModel
        .find({ visitedUserId: targetOid })
        .sort({ lastVisitedAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('visitorId', 'username displayName avatarUrl numericId level country')
        .exec(),
      this.visitModel.countDocuments({ visitedUserId: targetOid }).exec(),
    ]);

    const items = await this.hydrateUsers(
      visits.map((v) => (v as any).visitorId).filter((u: unknown) => u != null),
      callerUserId,
    );
    return { items, page, limit, total };
  }

  /** Visitors count for a single user — used to embed in profile
   *  responses. Cheap on the indexed `visitedUserId` field. */
  async visitorsCount(userId: string): Promise<number> {
    if (!Types.ObjectId.isValid(userId)) return 0;
    return this.visitModel
      .countDocuments({ visitedUserId: new Types.ObjectId(userId) })
      .exec();
  }

  // ============== Block / Unblock ==============

  /**
   * Idempotent block. Returns `created: true` only on the first insert.
   * Inserting under the unique compound index handles concurrent calls
   * safely — the second one falls through as a no-op.
   *
   * Side-effects: severs the follow edges in BOTH directions so the
   * blocked user disappears from the blocker's follower / following
   * lists immediately. The follow counters are decremented in lockstep.
   * If the user later unblocks, follows do NOT auto-restore — that's
   * intentional, the relationship has to be re-established.
   */
  async blockUser(
    blockerId: string,
    blockedId: string,
  ): Promise<{ created: boolean }> {
    if (
      !Types.ObjectId.isValid(blockerId) ||
      !Types.ObjectId.isValid(blockedId)
    ) {
      throw new BadRequestException({
        code: 'INVALID_ID',
        message: 'Invalid id',
      });
    }
    if (blockerId === blockedId) {
      throw new BadRequestException({
        code: 'CANNOT_BLOCK_SELF',
        message: 'You cannot block yourself',
      });
    }
    const blockerOid = new Types.ObjectId(blockerId);
    const blockedOid = new Types.ObjectId(blockedId);

    const targetExists = await this.userModel
      .exists({ _id: blockedOid })
      .exec();
    if (!targetExists) {
      throw new NotFoundException({
        code: 'USER_NOT_FOUND',
        message: 'User not found',
      });
    }

    try {
      await this.blockModel.create({
        blockerId: blockerOid,
        blockedId: blockedOid,
      });
    } catch (err: any) {
      // Already blocked — idempotent.
      if (err?.code === 11000) return { created: false };
      throw err;
    }

    // Drop both follow edges so feeds and follower lists reflect the
    // block immediately. Both deletes are independent so we run them
    // in parallel; if either had no row to delete, the corresponding
    // counter $inc is skipped.
    const [forwardDel, reverseDel] = await Promise.all([
      this.followModel
        .deleteOne({ followerId: blockerOid, followeeId: blockedOid })
        .exec(),
      this.followModel
        .deleteOne({ followerId: blockedOid, followeeId: blockerOid })
        .exec(),
    ]);
    const ops: Promise<unknown>[] = [];
    if (forwardDel.deletedCount > 0) {
      ops.push(
        this.userModel
          .updateOne({ _id: blockerOid }, { $inc: { followingCount: -1 } })
          .exec(),
        this.userModel
          .updateOne({ _id: blockedOid }, { $inc: { followersCount: -1 } })
          .exec(),
      );
    }
    if (reverseDel.deletedCount > 0) {
      ops.push(
        this.userModel
          .updateOne({ _id: blockedOid }, { $inc: { followingCount: -1 } })
          .exec(),
        this.userModel
          .updateOne({ _id: blockerOid }, { $inc: { followersCount: -1 } })
          .exec(),
      );
    }
    if (ops.length) await Promise.all(ops);
    return { created: true };
  }

  async unblockUser(
    blockerId: string,
    blockedId: string,
  ): Promise<{ removed: boolean }> {
    if (
      !Types.ObjectId.isValid(blockerId) ||
      !Types.ObjectId.isValid(blockedId)
    ) {
      return { removed: false };
    }
    const res = await this.blockModel
      .deleteOne({
        blockerId: new Types.ObjectId(blockerId),
        blockedId: new Types.ObjectId(blockedId),
      })
      .exec();
    return { removed: res.deletedCount > 0 };
  }

  /** "Has [blockerId] blocked [blockedId]?" — single-direction. */
  async isBlocked(blockerId: string, blockedId: string): Promise<boolean> {
    if (
      !Types.ObjectId.isValid(blockerId) ||
      !Types.ObjectId.isValid(blockedId) ||
      blockerId === blockedId
    ) {
      return false;
    }
    const exists = await this.blockModel
      .exists({
        blockerId: new Types.ObjectId(blockerId),
        blockedId: new Types.ObjectId(blockedId),
      })
      .exec();
    return Boolean(exists);
  }

  /** True if either user has blocked the other — used to gate DM, room
   *  joins, profile views. */
  async isMutuallyBlocked(userA: string, userB: string): Promise<boolean> {
    if (
      !Types.ObjectId.isValid(userA) ||
      !Types.ObjectId.isValid(userB) ||
      userA === userB
    ) {
      return false;
    }
    const a = new Types.ObjectId(userA);
    const b = new Types.ObjectId(userB);
    const exists = await this.blockModel
      .exists({
        $or: [
          { blockerId: a, blockedId: b },
          { blockerId: b, blockedId: a },
        ],
      })
      .exec();
    return Boolean(exists);
  }

  /**
   * Returns the set of user IDs that should be excluded from any list
   * shown to `userId` — both users they've blocked AND users who have
   * blocked them. Used by feed / search / chat filters.
   *
   * Stringified ids so callers can drop them straight into a `Set`
   * for O(1) membership testing without re-stringifying ObjectIds.
   */
  async hiddenUserIdsFor(userId: string): Promise<string[]> {
    if (!Types.ObjectId.isValid(userId)) return [];
    const oid = new Types.ObjectId(userId);
    const rows = await this.blockModel
      .find({ $or: [{ blockerId: oid }, { blockedId: oid }] })
      .select('blockerId blockedId')
      .lean()
      .exec();
    const ids = new Set<string>();
    for (const r of rows) {
      const a = r.blockerId?.toString();
      const b = r.blockedId?.toString();
      if (a && a !== userId) ids.add(a);
      if (b && b !== userId) ids.add(b);
    }
    return [...ids];
  }

  /** Paged "users I have blocked" list — drives the Settings →
   *  Blocked Users page in the mobile app. */
  async listBlocked(
    blockerId: string,
    params: { page?: number; limit?: number },
  ) {
    if (!Types.ObjectId.isValid(blockerId)) {
      throw new BadRequestException({
        code: 'INVALID_ID',
        message: 'Invalid id',
      });
    }
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(50, Math.max(1, params.limit ?? 20));
    const skip = (page - 1) * limit;
    const filter = { blockerId: new Types.ObjectId(blockerId) };

    const [edges, total] = await Promise.all([
      this.blockModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate(
          'blockedId',
          'username displayName avatarUrl numericId level country',
        )
        .exec(),
      this.blockModel.countDocuments(filter).exec(),
    ]);

    // hydrateUsers would mark `isFollowing: true` for any preserved
    // follow row (there shouldn't be any after block, but defensively
    // we pass `null` as caller so isFollowing is always false on this
    // list — it's noise for an unblock surface).
    const items = await this.hydrateUsers(
      edges.map((e) => (e as any).blockedId).filter((u) => u != null),
      null,
    );
    return { items, page, limit, total };
  }

  // ============== Helpers ==============

  /** Map a list of populated User docs to the public list shape and
   *  decorate each row with the caller's `isFollowing` flag in one
   *  bulk query. Filters out any user that's on either side of a
   *  block edge with the caller — same hidden-set rule used by the
   *  search and feed paths. */
  private async hydrateUsers(
    users: any[],
    callerUserId: string | null,
  ): Promise<UserListView[]> {
    if (users.length === 0) return [];

    // Strip blocked users *first* so `isFollowing` lookups don't waste
    // a round-trip on rows we're about to drop.
    let visibleUsers = users;
    if (callerUserId && Types.ObjectId.isValid(callerUserId)) {
      const hidden = new Set(await this.hiddenUserIdsFor(callerUserId));
      if (hidden.size > 0) {
        visibleUsers = users.filter((u) => {
          const id = (u._id ?? u.id)?.toString();
          return id ? !hidden.has(id) : true;
        });
      }
    }
    if (visibleUsers.length === 0) return [];

    let following = new Set<string>();
    if (callerUserId && Types.ObjectId.isValid(callerUserId)) {
      const callerOid = new Types.ObjectId(callerUserId);
      const ids = visibleUsers
        .map((u) => (u._id ?? u.id)?.toString())
        .filter((id): id is string => !!id)
        .map((id) => new Types.ObjectId(id));
      const edges = await this.followModel
        .find({ followerId: callerOid, followeeId: { $in: ids } })
        .select('followeeId')
        .lean()
        .exec();
      following = new Set(edges.map((e) => e.followeeId.toString()));
    }
    return visibleUsers.map((u) => {
      const id = (u._id ?? u.id)?.toString() ?? '';
      return {
        id,
        numericId: u.numericId ?? null,
        displayName: u.displayName ?? '',
        username: u.username ?? null,
        avatarUrl: u.avatarUrl ?? '',
        level: u.level ?? 1,
        country: u.country ?? '',
        isFollowing: following.has(id),
      };
    });
  }
}
