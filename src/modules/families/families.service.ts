import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { randomUUID } from 'crypto';

import { SvipService } from '../svip/svip.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { Currency, TxnType } from '../wallet/schemas/transaction.schema';
import { WalletService } from '../wallet/wallet.service';
import { CreateFamilyDto, UpdateFamilyDto } from './dto/family.dto';
import {
  FamilyMember,
  FamilyMemberDocument,
  FamilyMemberRole,
  FamilyMemberStatus,
} from './schemas/family-member.schema';
import {
  Family,
  FamilyDocument,
  FamilyJoinMode,
  FamilyStatus,
} from './schemas/family.schema';

/** Tier (inclusive) at and above which family creation is free. */
const FAMILY_FREE_SVIP_TIER = 4;

/** Coin price for non-SVIP4+ users. Per the in-app create-family screen. */
const FAMILY_CREATE_FEE_COINS = 6_000_000;

/** Once a name / cover is changed, lock further edits for this many ms. */
const EDIT_THROTTLE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

interface ListFamiliesParams {
  page?: number;
  limit?: number;
  status?: FamilyStatus;
  search?: string;
}

@Injectable()
export class FamiliesService {
  constructor(
    @InjectModel(Family.name) private readonly familyModel: Model<FamilyDocument>,
    @InjectModel(FamilyMember.name)
    private readonly memberModel: Model<FamilyMemberDocument>,
    private readonly wallet: WalletService,
    private readonly svip: SvipService,
    private readonly config: SystemConfigService,
  ) {}

  /**
   * Hard kill switch — admin sets `familiesEnabled: false` in system config
   * to disable family creation/joining without redeploying. Existing
   * families keep working (read endpoints stay open).
   */
  private async assertFeatureEnabled(): Promise<void> {
    if (!(await this.config.familiesEnabled())) {
      throw new ForbiddenException({
        code: 'FAMILY_FEATURE_DISABLED',
        message: 'The family feature is currently disabled.',
      });
    }
  }

  // ============================================================
  // Read paths
  // ============================================================

  async list(params: ListFamiliesParams) {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(100, Math.max(1, params.limit ?? 20));
    const skip = (page - 1) * limit;

    const filter: FilterQuery<FamilyDocument> = {};
    if (params.status) filter.status = params.status;
    if (params.search) {
      const escaped = params.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.name = new RegExp(escaped, 'i');
    }

    const [items, total] = await Promise.all([
      this.familyModel
        .find(filter)
        .sort({ memberCount: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.familyModel.countDocuments(filter).exec(),
    ]);
    return { items, page, limit, total };
  }

  async getByIdOrThrow(id: string): Promise<FamilyDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException({ code: 'FAMILY_NOT_FOUND', message: 'Family not found' });
    }
    const family = await this.familyModel.findById(id).exec();
    if (!family) {
      throw new NotFoundException({ code: 'FAMILY_NOT_FOUND', message: 'Family not found' });
    }
    return family;
  }

  /** Resolve the caller's current family (if any). Used by the mobile "my family" view. */
  async findMyFamily(userId: string): Promise<{
    family: FamilyDocument | null;
    membership: FamilyMemberDocument | null;
  }> {
    if (!Types.ObjectId.isValid(userId)) return { family: null, membership: null };
    const membership = await this.memberModel
      .findOne({ userId: new Types.ObjectId(userId), status: FamilyMemberStatus.ACTIVE })
      .exec();
    if (!membership) return { family: null, membership: null };
    const family = await this.familyModel.findById(membership.familyId).exec();
    return { family, membership };
  }

  /** Roster for the family detail page. Pending requests are filtered separately. */
  async listMembers(
    familyId: string,
    opts: { page?: number; limit?: number; status?: FamilyMemberStatus } = {},
  ) {
    const family = await this.getByIdOrThrow(familyId);
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(200, Math.max(1, opts.limit ?? 50));
    const skip = (page - 1) * limit;
    const status = opts.status ?? FamilyMemberStatus.ACTIVE;

    const filter: FilterQuery<FamilyMemberDocument> = {
      familyId: family._id,
      status,
    };
    const [items, total] = await Promise.all([
      this.memberModel
        .find(filter)
        .sort({ role: 1, joinedAt: 1 })
        .skip(skip)
        .limit(limit)
        .populate('userId', 'displayName username avatarUrl numericId')
        .exec(),
      this.memberModel.countDocuments(filter).exec(),
    ]);
    return { items, page, limit, total };
  }

  // ============================================================
  // Create — mobile flow with SVIP4 gate / 6M-coin debit
  // ============================================================

  async create(input: CreateFamilyDto, userId: string): Promise<FamilyDocument> {
    await this.assertFeatureEnabled();
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException({ code: 'INVALID_USER_ID', message: 'Invalid user' });
    }

    // 1. One-family-at-a-time guard. The unique index on FamilyMember.userId
    //    is the canonical enforcement; this is just a friendlier error.
    const existing = await this.memberModel
      .findOne({ userId: new Types.ObjectId(userId) })
      .exec();
    if (existing) {
      throw new ConflictException({
        code: 'ALREADY_IN_FAMILY',
        message: 'You are already in a family. Leave it before creating a new one.',
      });
    }

    // 2. SVIP4+ creates for free; everyone else pays the coin fee.
    const status = await this.svip.getStatus(userId);
    const tier = status?.currentLevel ?? 0;
    const isFree = tier >= FAMILY_FREE_SVIP_TIER;
    const fee = isFree ? 0 : FAMILY_CREATE_FEE_COINS;

    if (fee > 0) {
      // WalletService.debit is idempotent on idempotencyKey and atomic on
      // balance — throws INSUFFICIENT_BALANCE / WALLET_FROZEN. The family
      // doc is created AFTER the debit succeeds, so a failed debit leaves
      // no stranded family record.
      await this.wallet.debit(Currency.COINS, {
        userId,
        amount: fee,
        type: TxnType.FAMILY_CREATE_FEE,
        description: `Family creation fee — "${input.name}"`,
        idempotencyKey: `family-create-${userId}-${randomUUID()}`,
        refType: 'family',
        performedBy: userId,
      });
    }

    // 3. Insert family. memberCount=1 (just the leader).
    const family = await this.familyModel.create({
      name: input.name,
      coverUrl: input.coverUrl ?? '',
      coverPublicId: input.coverPublicId ?? '',
      notification: input.notification ?? '',
      joinMode: input.joinMode ?? FamilyJoinMode.REVIEW,
      joinLevelRequirement: input.joinLevelRequirement ?? 0,
      leaderId: new Types.ObjectId(userId),
      memberCount: 1,
      createdBy: new Types.ObjectId(userId),
      creationFeePaid: fee,
      status: FamilyStatus.ACTIVE,
    });

    // 4. Insert leader as the first FamilyMember.
    await this.memberModel.create({
      familyId: family._id,
      userId: new Types.ObjectId(userId),
      role: FamilyMemberRole.LEADER,
      status: FamilyMemberStatus.ACTIVE,
    });

    return family;
  }

  // ============================================================
  // Update — leader / co-leader editing metadata
  // ============================================================

  async update(
    familyId: string,
    update: UpdateFamilyDto,
    userId: string,
  ): Promise<FamilyDocument> {
    const family = await this.getByIdOrThrow(familyId);
    await this.assertCanManage(family, userId);

    const now = new Date();

    if (update.name !== undefined && update.name !== family.name) {
      this.assertEditAllowed(family.lastNameChangedAt, 'name');
      family.name = update.name;
      family.lastNameChangedAt = now;
    }

    if (update.coverUrl !== undefined && update.coverUrl !== family.coverUrl) {
      this.assertEditAllowed(family.lastCoverChangedAt, 'cover');
      family.coverUrl = update.coverUrl;
      family.coverPublicId = update.coverPublicId ?? '';
      family.lastCoverChangedAt = now;
    }

    if (update.notification !== undefined) family.notification = update.notification;
    if (update.joinMode !== undefined) family.joinMode = update.joinMode;
    if (update.joinLevelRequirement !== undefined) {
      family.joinLevelRequirement = update.joinLevelRequirement;
    }

    await family.save();
    return family;
  }

  // ============================================================
  // Join flow
  // ============================================================

  /**
   * User applies to join. For OPEN families this admits immediately; for
   * REVIEW it inserts a PENDING row that a leader / co-leader must approve.
   * INVITE_ONLY rejects — the user must be invited by a leader instead.
   */
  async requestJoin(
    familyId: string,
    userId: string,
  ): Promise<FamilyMemberDocument> {
    await this.assertFeatureEnabled();
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException({ code: 'INVALID_USER_ID', message: 'Invalid user' });
    }
    const family = await this.getByIdOrThrow(familyId);
    if (family.status !== FamilyStatus.ACTIVE) {
      throw new ForbiddenException({
        code: 'FAMILY_NOT_OPEN',
        message: 'This family is not accepting new members.',
      });
    }
    if (family.joinMode === FamilyJoinMode.INVITE_ONLY) {
      throw new ForbiddenException({
        code: 'FAMILY_INVITE_ONLY',
        message: 'This family is invite-only.',
      });
    }

    const userObj = new Types.ObjectId(userId);

    // Reject if already a member or pending anywhere — userId is unique.
    const existing = await this.memberModel.findOne({ userId: userObj }).exec();
    if (existing) {
      throw new ConflictException({
        code: 'ALREADY_IN_FAMILY',
        message: 'You are already in a family or have a pending request.',
      });
    }

    const isOpen = family.joinMode === FamilyJoinMode.OPEN;
    const member = await this.memberModel.create({
      familyId: family._id,
      userId: userObj,
      role: FamilyMemberRole.MEMBER,
      status: isOpen ? FamilyMemberStatus.ACTIVE : FamilyMemberStatus.PENDING,
    });

    if (isOpen) await this.bumpMemberCount(family, +1);
    return member;
  }

  /**
   * Leader / co-leader approves a pending join. Flips status → ACTIVE and
   * bumps the family's denormalized memberCount.
   */
  async approveJoin(
    familyId: string,
    pendingUserId: string,
    approverId: string,
  ): Promise<FamilyMemberDocument> {
    const family = await this.getByIdOrThrow(familyId);
    await this.assertCanManage(family, approverId);
    if (!Types.ObjectId.isValid(pendingUserId)) {
      throw new BadRequestException({ code: 'INVALID_USER_ID', message: 'Invalid user' });
    }

    const member = await this.memberModel
      .findOne({
        familyId: family._id,
        userId: new Types.ObjectId(pendingUserId),
        status: FamilyMemberStatus.PENDING,
      })
      .exec();
    if (!member) {
      throw new NotFoundException({
        code: 'REQUEST_NOT_FOUND',
        message: 'No pending request from that user',
      });
    }

    member.status = FamilyMemberStatus.ACTIVE;
    member.joinedAt = new Date();
    await member.save();
    await this.bumpMemberCount(family, +1);
    return member;
  }

  /**
   * Leader / co-leader rejects a pending join → row removed entirely so the
   * user can apply elsewhere.
   */
  async rejectJoin(
    familyId: string,
    pendingUserId: string,
    approverId: string,
  ): Promise<void> {
    const family = await this.getByIdOrThrow(familyId);
    await this.assertCanManage(family, approverId);
    if (!Types.ObjectId.isValid(pendingUserId)) {
      throw new BadRequestException({ code: 'INVALID_USER_ID', message: 'Invalid user' });
    }
    await this.memberModel
      .deleteOne({
        familyId: family._id,
        userId: new Types.ObjectId(pendingUserId),
        status: FamilyMemberStatus.PENDING,
      })
      .exec();
  }

  // ============================================================
  // Leave / kick / transfer leadership
  // ============================================================

  /**
   * Member quits voluntarily. Leader cannot leave without first transferring
   * leadership — the family must always have a leader.
   */
  async leave(familyId: string, userId: string): Promise<void> {
    const family = await this.getByIdOrThrow(familyId);
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException({ code: 'INVALID_USER_ID', message: 'Invalid user' });
    }
    const userObj = new Types.ObjectId(userId);
    if (family.leaderId.equals(userObj)) {
      throw new ForbiddenException({
        code: 'LEADER_CANNOT_LEAVE',
        message: 'Transfer leadership before leaving the family.',
      });
    }
    const member = await this.memberModel
      .findOne({ familyId: family._id, userId: userObj, status: FamilyMemberStatus.ACTIVE })
      .exec();
    if (!member) {
      throw new NotFoundException({
        code: 'NOT_A_MEMBER',
        message: 'You are not a member of this family',
      });
    }
    if (member.role === FamilyMemberRole.CO_LEADER) {
      family.coLeaderIds = family.coLeaderIds.filter((id) => !id.equals(userObj));
    }
    await member.deleteOne();
    await this.bumpMemberCount(family, -1);
  }

  /**
   * Leader / co-leader removes another member. Cannot kick the leader; a
   * co-leader cannot kick another co-leader (only the leader can demote /
   * kick co-leaders, via `transferLeadership` or this method).
   */
  async kick(
    familyId: string,
    targetUserId: string,
    actorUserId: string,
  ): Promise<void> {
    const family = await this.getByIdOrThrow(familyId);
    await this.assertCanManage(family, actorUserId);
    if (!Types.ObjectId.isValid(targetUserId)) {
      throw new BadRequestException({ code: 'INVALID_USER_ID', message: 'Invalid user' });
    }
    const targetObj = new Types.ObjectId(targetUserId);
    if (family.leaderId.equals(targetObj)) {
      throw new ForbiddenException({
        code: 'CANNOT_KICK_LEADER',
        message: 'The leader cannot be kicked.',
      });
    }
    const target = await this.memberModel
      .findOne({ familyId: family._id, userId: targetObj, status: FamilyMemberStatus.ACTIVE })
      .exec();
    if (!target) {
      throw new NotFoundException({
        code: 'NOT_A_MEMBER',
        message: 'Target is not a member',
      });
    }

    // Only the leader can kick a co-leader. Co-leaders kick regular members only.
    const actorObj = new Types.ObjectId(actorUserId);
    const actorIsLeader = family.leaderId.equals(actorObj);
    if (target.role === FamilyMemberRole.CO_LEADER && !actorIsLeader) {
      throw new ForbiddenException({
        code: 'CANNOT_KICK_CO_LEADER',
        message: 'Only the leader can remove a co-leader.',
      });
    }

    if (target.role === FamilyMemberRole.CO_LEADER) {
      family.coLeaderIds = family.coLeaderIds.filter((id) => !id.equals(targetObj));
    }
    await target.deleteOne();
    await this.bumpMemberCount(family, -1);
  }

  /** Promote an existing member to co-leader (leader-only). */
  async promoteToCoLeader(
    familyId: string,
    targetUserId: string,
    actorUserId: string,
  ): Promise<FamilyDocument> {
    const family = await this.getByIdOrThrow(familyId);
    if (!family.leaderId.equals(new Types.ObjectId(actorUserId))) {
      throw new ForbiddenException({
        code: 'NOT_LEADER',
        message: 'Only the leader can promote members.',
      });
    }
    if (!Types.ObjectId.isValid(targetUserId)) {
      throw new BadRequestException({ code: 'INVALID_USER_ID', message: 'Invalid user' });
    }
    const targetObj = new Types.ObjectId(targetUserId);
    const target = await this.memberModel
      .findOne({ familyId: family._id, userId: targetObj, status: FamilyMemberStatus.ACTIVE })
      .exec();
    if (!target) {
      throw new NotFoundException({ code: 'NOT_A_MEMBER', message: 'Target is not a member' });
    }
    target.role = FamilyMemberRole.CO_LEADER;
    await target.save();
    if (!family.coLeaderIds.some((id) => id.equals(targetObj))) {
      family.coLeaderIds.push(targetObj);
    }
    await family.save();
    return family;
  }

  /** Demote a co-leader back to regular member (leader-only). */
  async demoteCoLeader(
    familyId: string,
    targetUserId: string,
    actorUserId: string,
  ): Promise<FamilyDocument> {
    const family = await this.getByIdOrThrow(familyId);
    if (!family.leaderId.equals(new Types.ObjectId(actorUserId))) {
      throw new ForbiddenException({
        code: 'NOT_LEADER',
        message: 'Only the leader can demote co-leaders.',
      });
    }
    if (!Types.ObjectId.isValid(targetUserId)) {
      throw new BadRequestException({ code: 'INVALID_USER_ID', message: 'Invalid user' });
    }
    const targetObj = new Types.ObjectId(targetUserId);
    const target = await this.memberModel
      .findOne({ familyId: family._id, userId: targetObj, status: FamilyMemberStatus.ACTIVE })
      .exec();
    if (!target) {
      throw new NotFoundException({ code: 'NOT_A_MEMBER', message: 'Target is not a member' });
    }
    target.role = FamilyMemberRole.MEMBER;
    await target.save();
    family.coLeaderIds = family.coLeaderIds.filter((id) => !id.equals(targetObj));
    await family.save();
    return family;
  }

  /**
   * Hand the leader role to an existing co-leader (or any active member).
   * Old leader becomes a regular member; target's previous role doesn't matter.
   */
  async transferLeadership(
    familyId: string,
    newLeaderUserId: string,
    actorUserId: string,
  ): Promise<FamilyDocument> {
    const family = await this.getByIdOrThrow(familyId);
    if (!family.leaderId.equals(new Types.ObjectId(actorUserId))) {
      throw new ForbiddenException({
        code: 'NOT_LEADER',
        message: 'Only the current leader can transfer leadership.',
      });
    }
    if (!Types.ObjectId.isValid(newLeaderUserId)) {
      throw new BadRequestException({ code: 'INVALID_USER_ID', message: 'Invalid user' });
    }
    const newLeaderObj = new Types.ObjectId(newLeaderUserId);
    if (family.leaderId.equals(newLeaderObj)) {
      throw new BadRequestException({
        code: 'ALREADY_LEADER',
        message: 'That user is already the leader.',
      });
    }
    const newLeaderMember = await this.memberModel
      .findOne({
        familyId: family._id,
        userId: newLeaderObj,
        status: FamilyMemberStatus.ACTIVE,
      })
      .exec();
    if (!newLeaderMember) {
      throw new NotFoundException({
        code: 'NOT_A_MEMBER',
        message: 'New leader must be an active member',
      });
    }
    const oldLeaderObj = family.leaderId;
    const oldLeaderMember = await this.memberModel
      .findOne({ familyId: family._id, userId: oldLeaderObj })
      .exec();

    family.leaderId = newLeaderObj;
    // Old leader becomes a regular member (gets stripped from coLeaderIds anyway).
    family.coLeaderIds = family.coLeaderIds.filter((id) => !id.equals(newLeaderObj));
    await family.save();

    newLeaderMember.role = FamilyMemberRole.LEADER;
    await newLeaderMember.save();
    if (oldLeaderMember) {
      oldLeaderMember.role = FamilyMemberRole.MEMBER;
      await oldLeaderMember.save();
    }
    return family;
  }

  // ============================================================
  // Admin actions — freeze / unfreeze / force-disband
  // ============================================================

  async setStatus(familyId: string, status: FamilyStatus): Promise<FamilyDocument> {
    const family = await this.getByIdOrThrow(familyId);
    if (status === FamilyStatus.DISBANDED && family.status !== FamilyStatus.DISBANDED) {
      // Detach all members, including pending requests. We don't refund the
      // creation fee — admin disband is treated as a policy action.
      await this.memberModel.deleteMany({ familyId: family._id }).exec();
      family.memberCount = 0;
      family.soloSince = null;
    }
    family.status = status;
    await family.save();
    return family;
  }

  /**
   * Cron entry point: scan for families that have been at memberCount == 1
   * for ≥ 7 days and disband them. Returns count of disbanded families for
   * logging / observability.
   */
  async disbandStaleSolos(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const stale = await this.familyModel
      .find({
        status: FamilyStatus.ACTIVE,
        memberCount: 1,
        soloSince: { $lte: cutoff, $ne: null },
      })
      .exec();

    for (const f of stale) {
      await this.memberModel.deleteMany({ familyId: f._id }).exec();
      f.memberCount = 0;
      f.soloSince = null;
      f.status = FamilyStatus.DISBANDED;
      await f.save();
    }
    return stale.length;
  }

  // ============================================================
  // Internal helpers
  // ============================================================

  /**
   * Bump the family's denormalized memberCount AND maintain the soloSince
   * timestamp that drives the auto-disband sweeper. soloSince is set only
   * when the count *drops* to 1, and cleared when it climbs back above 1.
   */
  private async bumpMemberCount(family: FamilyDocument, delta: number): Promise<void> {
    family.memberCount += delta;
    if (family.memberCount <= 1 && !family.soloSince) {
      family.soloSince = new Date();
    } else if (family.memberCount > 1 && family.soloSince) {
      family.soloSince = null;
    }
    await family.save();
  }

  /** Throw if the user is not the leader or a co-leader. */
  private async assertCanManage(family: FamilyDocument, userId: string): Promise<void> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new ForbiddenException({ code: 'NOT_AUTHORIZED', message: 'Not authorized' });
    }
    const userObj = new Types.ObjectId(userId);
    const isLeader = family.leaderId.equals(userObj);
    const isCoLeader = family.coLeaderIds.some((id) => id.equals(userObj));
    if (!isLeader && !isCoLeader) {
      throw new ForbiddenException({
        code: 'NOT_AUTHORIZED',
        message: 'Only the leader or co-leaders can do this.',
      });
    }
  }

  /** Enforce once-per-30-days for name / cover edits. */
  private assertEditAllowed(lastChangedAt: Date | null | undefined, fieldLabel: string): void {
    if (!lastChangedAt) return;
    const elapsed = Date.now() - lastChangedAt.getTime();
    if (elapsed < EDIT_THROTTLE_MS) {
      const daysLeft = Math.ceil((EDIT_THROTTLE_MS - elapsed) / (24 * 60 * 60 * 1000));
      throw new ConflictException({
        code: 'EDIT_THROTTLED',
        message: `${fieldLabel} can be changed once every 30 days. Try again in ${daysLeft} day(s).`,
        details: { fieldLabel, daysLeft },
      });
    }
  }
}
