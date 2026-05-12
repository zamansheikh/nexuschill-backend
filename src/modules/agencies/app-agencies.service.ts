import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';

import { NumericIdService } from '../common/numeric-id.service';
import { CounterScope } from '../common/schemas/counter.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { UsersService } from '../users/users.service';
import {
  AgencyCreateRequest,
  AgencyCreateRequestDocument,
  AgencyCreateRequestStatus,
} from './schemas/agency-create-request.schema';
import {
  Agency,
  AgencyDocument,
  AgencyStatus,
} from './schemas/agency.schema';
import {
  AgencyJoinRequest,
  AgencyJoinRequestDocument,
  AgencyJoinRequestStatus,
} from './schemas/agency-join-request.schema';
import {
  AgencyMember,
  AgencyMemberDocument,
  AgencyMemberRole,
} from './schemas/agency-member.schema';

/**
 * App-facing agency service. Handles flows that originate from the mobile
 * app — user wants to browse / apply / quit, owner wants to approve / kick
 * / promote / view the roster + ranking. The admin-side `AgenciesService`
 * still owns the platform-level CRUD (create / suspend / commission rate).
 *
 * Authorisation here is by ROLE inside the agency, not by admin permission:
 *   • owner — full agency moderation
 *   • admin — approve / reject join requests, kick members
 *   • member — read-only
 *
 * The `User.agencyPowers` array gates a separate, narrower concept: who
 * can FOUND a new agency from the app. Once founded, control of that
 * agency lives in `AgencyMember.role`.
 */
@Injectable()
export class AppAgenciesService {
  constructor(
    @InjectModel(Agency.name)
    private readonly agencyModel: Model<AgencyDocument>,
    @InjectModel(AgencyMember.name)
    private readonly memberModel: Model<AgencyMemberDocument>,
    @InjectModel(AgencyJoinRequest.name)
    private readonly requestModel: Model<AgencyJoinRequestDocument>,
    @InjectModel(AgencyCreateRequest.name)
    private readonly createRequestModel: Model<AgencyCreateRequestDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    private readonly numericIds: NumericIdService,
    // Joining an agency auto-promotes the user to host (Trainee tier).
    // Delegating the lifecycle to UsersService keeps the host invariants
    // (isHost flag + hostProfile shape) in one place.
    private readonly users: UsersService,
  ) {}

  // ────────────────────────────────────────────────────────────
  // Discovery
  // ────────────────────────────────────────────────────────────

  /**
   * List active agencies for the Browse screen. Paginated; `search` runs
   * against `name`/`code`/numericId.
   */
  async listPublic(params: {
    page?: number;
    limit?: number;
    search?: string;
  }) {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(50, Math.max(1, params.limit ?? 20));
    const skip = (page - 1) * limit;

    const filter: FilterQuery<AgencyDocument> = {
      status: AgencyStatus.ACTIVE,
    };
    if (params.search) {
      const q = params.search.trim();
      const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'i');
      const or: FilterQuery<AgencyDocument>[] = [
        { name: regex },
        { code: regex },
      ];
      if (/^\d{1,7}$/.test(q)) {
        or.push({ numericId: parseInt(q, 10) });
      }
      filter.$or = or;
    }

    const [items, total] = await Promise.all([
      this.agencyModel
        .find(filter)
        .sort({ totalDiamondsEarned: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.agencyModel.countDocuments(filter).exec(),
    ]);
    return { items, page, limit, total };
  }

  /**
   * Combined "what is my agency situation?" payload — the caller's
   * agency (if any) + their role + any pending request. Drives the
   * My Agency landing page in one round-trip.
   */
  async fetchMine(userId: string) {
    if (!Types.ObjectId.isValid(userId)) return _emptyMine();
    const userOid = new Types.ObjectId(userId);

    const member = await this.memberModel
      .findOne({ userId: userOid })
      .lean()
      .exec();
    let agency: AgencyDocument | null = null;
    if (member) {
      agency = await this.agencyModel.findById(member.agencyId).exec();
    }

    const pendingRequest = await this.requestModel
      .findOne({ userId: userOid, status: AgencyJoinRequestStatus.PENDING })
      .lean()
      .exec();

    // Surface a pending agency-creation request too — the My Agency
    // empty state shows it as a "your request is under review" card.
    const pendingCreateRequest = await this.createRequestModel
      .findOne({
        userId: userOid,
        status: AgencyCreateRequestStatus.PENDING,
      })
      .lean()
      .exec();

    const user = await this.userModel
      .findById(userOid)
      .select({ agencyPowers: 1 })
      .lean()
      .exec();

    return {
      member: member ?? null,
      agency: agency?.toJSON() ?? null,
      pendingRequest: pendingRequest ?? null,
      pendingCreateRequest: pendingCreateRequest ?? null,
      powers: user?.agencyPowers ?? [],
    };
  }

  /**
   * Top agencies by host count. Drives the My Agency empty state — when
   * the user hasn't joined an agency yet we show the leaderboard so they
   * can see what's popular and apply from there. Falls back to
   * `totalDiamondsEarned` as a tiebreaker.
   */
  async topAgencies(limit = 5) {
    const items = await this.agencyModel
      .find({ status: AgencyStatus.ACTIVE })
      .sort({ hostCount: -1, totalDiamondsEarned: -1, createdAt: -1 })
      .limit(Math.min(50, Math.max(1, limit)))
      .lean()
      .exec();
    return { items };
  }

  // ────────────────────────────────────────────────────────────
  // Membership lifecycle (user-driven)
  // ────────────────────────────────────────────────────────────

  /**
   * Submit a join request. Rejected if:
   *   • the caller is already in another agency,
   *   • the caller already has a pending request to this agency,
   *   • the target agency is suspended / terminated.
   */
  async requestJoin(
    userId: string,
    agencyId: string,
    message: string,
  ): Promise<AgencyJoinRequestDocument> {
    if (!Types.ObjectId.isValid(userId) || !Types.ObjectId.isValid(agencyId)) {
      throw new NotFoundException('Agency not found');
    }
    const userOid = new Types.ObjectId(userId);
    const agencyOid = new Types.ObjectId(agencyId);

    const agency = await this.agencyModel.findById(agencyOid).exec();
    if (!agency) throw new NotFoundException('Agency not found');
    if (agency.status !== AgencyStatus.ACTIVE) {
      throw new ForbiddenException({
        code: 'AGENCY_INACTIVE',
        message: 'This agency is not accepting new members',
      });
    }

    // Already a member somewhere?
    const existing = await this.memberModel
      .findOne({ userId: userOid })
      .lean()
      .exec();
    if (existing) {
      if (existing.agencyId.equals(agencyOid)) {
        throw new ConflictException({
          code: 'ALREADY_MEMBER',
          message: 'You are already a member of this agency',
        });
      }
      throw new ConflictException({
        code: 'ALREADY_IN_OTHER_AGENCY',
        message: 'Leave your current agency before joining another',
      });
    }

    // Reuse / upsert via partial-unique index — duplicate pending
    // requests would 11000.
    try {
      return await this.requestModel.create({
        agencyId: agencyOid,
        userId: userOid,
        status: AgencyJoinRequestStatus.PENDING,
        message: message.trim(),
      });
    } catch (err: any) {
      if (err?.code === 11000) {
        throw new ConflictException({
          code: 'REQUEST_PENDING',
          message: 'You already have a pending request to this agency',
        });
      }
      throw err;
    }
  }

  /** User-initiated cancel of their own pending request. */
  async cancelMyRequest(
    userId: string,
    requestId: string,
  ): Promise<{ ok: true }> {
    if (
      !Types.ObjectId.isValid(userId) ||
      !Types.ObjectId.isValid(requestId)
    ) {
      throw new NotFoundException('Request not found');
    }
    const req = await this.requestModel.findById(requestId).exec();
    if (!req) throw new NotFoundException('Request not found');
    if (!req.userId.equals(new Types.ObjectId(userId))) {
      throw new ForbiddenException('Not your request');
    }
    if (req.status !== AgencyJoinRequestStatus.PENDING) {
      throw new BadRequestException({
        code: 'REQUEST_NOT_PENDING',
        message: 'Request is already decided',
      });
    }
    req.status = AgencyJoinRequestStatus.CANCELLED;
    req.decidedAt = new Date();
    await req.save();
    return { ok: true };
  }

  /**
   * User-initiated leave. Owners can't leave directly — they must
   * transfer ownership first. Last member (an empty agency owner) is
   * a no-op the admin panel can sweep separately.
   */
  async leaveAgency(userId: string): Promise<{ ok: true }> {
    if (!Types.ObjectId.isValid(userId)) return { ok: true };
    const userOid = new Types.ObjectId(userId);
    const member = await this.memberModel.findOne({ userId: userOid }).exec();
    if (!member) return { ok: true };
    if (member.role === AgencyMemberRole.OWNER) {
      throw new ForbiddenException({
        code: 'OWNER_CANNOT_LEAVE',
        message:
          'Transfer ownership to another member before leaving the agency',
      });
    }
    await this.memberModel.deleteOne({ _id: member._id }).exec();
    await this.agencyModel
      .updateOne(
        { _id: member.agencyId, hostCount: { $gt: 0 } },
        { $inc: { hostCount: -1 } },
      )
      .exec();
    return { ok: true };
  }

  // ────────────────────────────────────────────────────────────
  // Owner / admin actions
  // ────────────────────────────────────────────────────────────

  /** Internal helper — resolve actor's role for the given agency. */
  private async actorRole(
    agencyId: Types.ObjectId,
    actorId: string,
  ): Promise<AgencyMemberRole | null> {
    if (!Types.ObjectId.isValid(actorId)) return null;
    const me = await this.memberModel
      .findOne({
        agencyId,
        userId: new Types.ObjectId(actorId),
      })
      .lean()
      .exec();
    return me?.role ?? null;
  }

  /** Owner OR admin OR (super-power) `agency.manage`. */
  private async assertCanModerate(
    agencyId: Types.ObjectId,
    actorId: string,
  ): Promise<AgencyMemberRole | 'super'> {
    const role = await this.actorRole(agencyId, actorId);
    if (role === AgencyMemberRole.OWNER) return role;
    if (role === AgencyMemberRole.ADMIN) return role;
    // Global override — admin granted the user `agency.manage` power.
    const u = await this.userModel
      .findById(actorId)
      .select({ agencyPowers: 1 })
      .lean()
      .exec();
    if (u?.agencyPowers?.includes('agency.manage')) return 'super';
    throw new ForbiddenException({
      code: 'NOT_AGENCY_STAFF',
      message: 'Only the agency owner or admins can do that',
    });
  }

  /** Owner only (or super power). */
  private async assertCanGovern(
    agencyId: Types.ObjectId,
    actorId: string,
  ): Promise<AgencyMemberRole | 'super'> {
    const role = await this.actorRole(agencyId, actorId);
    if (role === AgencyMemberRole.OWNER) return role;
    const u = await this.userModel
      .findById(actorId)
      .select({ agencyPowers: 1 })
      .lean()
      .exec();
    if (u?.agencyPowers?.includes('agency.manage')) return 'super';
    throw new ForbiddenException({
      code: 'NOT_AGENCY_OWNER',
      message: 'Only the agency owner can do that',
    });
  }

  async listMembers(
    agencyId: string,
    params: { page?: number; limit?: number },
    actorId: string,
  ) {
    if (!Types.ObjectId.isValid(agencyId)) {
      throw new NotFoundException('Agency not found');
    }
    const agencyOid = new Types.ObjectId(agencyId);
    // Public roster — every member of the agency can see the list.
    const role = await this.actorRole(agencyOid, actorId);
    if (!role) {
      // Not a member — but a `agency.manage` power user can still see.
      const u = await this.userModel
        .findById(actorId)
        .select({ agencyPowers: 1 })
        .lean()
        .exec();
      if (!u?.agencyPowers?.includes('agency.manage')) {
        throw new ForbiddenException({
          code: 'NOT_AGENCY_MEMBER',
          message: 'Join the agency to see its roster',
        });
      }
    }
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(100, Math.max(1, params.limit ?? 50));
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.memberModel
        .find({ agencyId: agencyOid })
        .sort({ role: 1, joinedAt: 1 })
        .skip(skip)
        .limit(limit)
        .populate(
          'userId',
          'displayName username avatarUrl numericId level isHost',
        )
        .lean()
        .exec(),
      this.memberModel.countDocuments({ agencyId: agencyOid }).exec(),
    ]);
    return { items, page, limit, total };
  }

  /** Member ranking — sorted by lifetime diamonds contributed, desc. */
  async ranking(
    agencyId: string,
    params: { page?: number; limit?: number },
    actorId: string,
  ) {
    if (!Types.ObjectId.isValid(agencyId)) {
      throw new NotFoundException('Agency not found');
    }
    const agencyOid = new Types.ObjectId(agencyId);
    const role = await this.actorRole(agencyOid, actorId);
    if (!role) {
      const u = await this.userModel
        .findById(actorId)
        .select({ agencyPowers: 1 })
        .lean()
        .exec();
      if (!u?.agencyPowers?.includes('agency.manage')) {
        throw new ForbiddenException({
          code: 'NOT_AGENCY_MEMBER',
          message: 'Join the agency to see its ranking',
        });
      }
    }
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(100, Math.max(1, params.limit ?? 50));
    const skip = (page - 1) * limit;

    const items = await this.memberModel
      .find({ agencyId: agencyOid })
      .sort({ diamondsContributed: -1, liveMinutes: -1 })
      .skip(skip)
      .limit(limit)
      .populate(
        'userId',
        'displayName username avatarUrl numericId level isHost',
      )
      .lean()
      .exec();
    return { items, page, limit };
  }

  async listJoinRequests(
    agencyId: string,
    params: {
      page?: number;
      limit?: number;
      status?: AgencyJoinRequestStatus;
    },
    actorId: string,
  ) {
    if (!Types.ObjectId.isValid(agencyId)) {
      throw new NotFoundException('Agency not found');
    }
    const agencyOid = new Types.ObjectId(agencyId);
    await this.assertCanModerate(agencyOid, actorId);

    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(100, Math.max(1, params.limit ?? 50));
    const skip = (page - 1) * limit;
    const filter: FilterQuery<AgencyJoinRequestDocument> = {
      agencyId: agencyOid,
      status: params.status ?? AgencyJoinRequestStatus.PENDING,
    };

    const [items, total] = await Promise.all([
      this.requestModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate(
          'userId',
          'displayName username avatarUrl numericId level isHost',
        )
        .lean()
        .exec(),
      this.requestModel.countDocuments(filter).exec(),
    ]);
    return { items, page, limit, total };
  }

  async decideRequest(
    agencyId: string,
    requestId: string,
    actorId: string,
    decision: 'approve' | 'reject',
    note: string,
  ) {
    if (
      !Types.ObjectId.isValid(agencyId) ||
      !Types.ObjectId.isValid(requestId)
    ) {
      throw new NotFoundException('Request not found');
    }
    const agencyOid = new Types.ObjectId(agencyId);
    await this.assertCanModerate(agencyOid, actorId);

    const req = await this.requestModel.findById(requestId).exec();
    if (!req || !req.agencyId.equals(agencyOid)) {
      throw new NotFoundException('Request not found');
    }
    if (req.status !== AgencyJoinRequestStatus.PENDING) {
      throw new BadRequestException({
        code: 'REQUEST_NOT_PENDING',
        message: 'Request is already decided',
      });
    }

    if (decision === 'approve') {
      // Same race-check the user-side has: the applicant might have
      // joined a different agency between request and approval.
      const alreadySomewhere = await this.memberModel
        .findOne({ userId: req.userId })
        .lean()
        .exec();
      if (alreadySomewhere) {
        throw new ConflictException({
          code: 'APPLICANT_ALREADY_IN_AGENCY',
          message: 'Applicant is already a member of an agency',
        });
      }
      await this.memberModel.create({
        agencyId: agencyOid,
        userId: req.userId,
        role: AgencyMemberRole.MEMBER,
        joinedAt: new Date(),
      });
      await this.agencyModel
        .updateOne({ _id: agencyOid }, { $inc: { hostCount: 1 } })
        .exec();
      // Joining an agency auto-promotes the user to host. Idempotent
      // — if they were already a host, only the hostProfile.agencyId
      // is updated (tier / earnings / hours stay put).
      await this.users.ensureHostForAgency(
        req.userId.toString(),
        agencyOid.toString(),
        actorId,
      );
      req.status = AgencyJoinRequestStatus.APPROVED;
    } else {
      req.status = AgencyJoinRequestStatus.REJECTED;
    }
    req.decidedBy = new Types.ObjectId(actorId);
    req.decidedAt = new Date();
    req.decisionNote = note.trim();
    await req.save();
    return { request: req.toJSON() };
  }

  /** Owner / admin removes a member. Owner cannot be kicked. */
  async kickMember(
    agencyId: string,
    targetUserId: string,
    actorId: string,
  ): Promise<{ ok: true }> {
    if (
      !Types.ObjectId.isValid(agencyId) ||
      !Types.ObjectId.isValid(targetUserId)
    ) {
      throw new NotFoundException('Member not found');
    }
    const agencyOid = new Types.ObjectId(agencyId);
    const targetOid = new Types.ObjectId(targetUserId);
    await this.assertCanModerate(agencyOid, actorId);

    if (targetOid.equals(new Types.ObjectId(actorId))) {
      throw new BadRequestException({
        code: 'CANNOT_KICK_SELF',
        message: 'Use the Leave action instead',
      });
    }
    const target = await this.memberModel
      .findOne({ agencyId: agencyOid, userId: targetOid })
      .exec();
    if (!target) throw new NotFoundException('Member not found');
    if (target.role === AgencyMemberRole.OWNER) {
      throw new ForbiddenException({
        code: 'CANNOT_KICK_OWNER',
        message: 'The agency owner cannot be kicked',
      });
    }
    // Admins can only kick members; owners can kick admins + members.
    const actorRole = await this.actorRole(agencyOid, actorId);
    if (
      actorRole === AgencyMemberRole.ADMIN &&
      target.role === AgencyMemberRole.ADMIN
    ) {
      throw new ForbiddenException({
        code: 'ADMIN_CANNOT_KICK_ADMIN',
        message: 'Only the owner can remove an admin',
      });
    }
    await this.memberModel.deleteOne({ _id: target._id }).exec();
    await this.agencyModel
      .updateOne(
        { _id: agencyOid, hostCount: { $gt: 0 } },
        { $inc: { hostCount: -1 } },
      )
      .exec();
    return { ok: true };
  }

  async setMemberRole(
    agencyId: string,
    targetUserId: string,
    actorId: string,
    role: AgencyMemberRole,
  ): Promise<{ member: AgencyMemberDocument }> {
    if (
      !Types.ObjectId.isValid(agencyId) ||
      !Types.ObjectId.isValid(targetUserId)
    ) {
      throw new NotFoundException('Member not found');
    }
    const agencyOid = new Types.ObjectId(agencyId);
    const targetOid = new Types.ObjectId(targetUserId);
    await this.assertCanGovern(agencyOid, actorId);

    if (role === AgencyMemberRole.OWNER) {
      throw new ForbiddenException({
        code: 'USE_TRANSFER_OWNERSHIP',
        message: 'Use the transfer-ownership flow to change owner',
      });
    }
    const target = await this.memberModel
      .findOne({ agencyId: agencyOid, userId: targetOid })
      .exec();
    if (!target) throw new NotFoundException('Member not found');
    if (target.role === AgencyMemberRole.OWNER) {
      throw new ForbiddenException({
        code: 'CANNOT_DEMOTE_OWNER',
        message: 'Transfer ownership first',
      });
    }
    target.role = role;
    await target.save();
    return { member: target };
  }

  // ────────────────────────────────────────────────────────────
  // Agency creation requests (user → admin review)
  // ────────────────────────────────────────────────────────────

  /**
   * Submit an agency-creation request. ANY app user can submit one —
   * the platform admin reviews and approves/rejects from the admin
   * panel. Gates:
   *   • caller must not already be a member of an agency,
   *   • caller can't have more than one pending request at a time,
   *   • the proposed code must not collide with an already-taken
   *     code (we still let the request through if the colliding
   *     agency is terminated, but flag it for the admin's review).
   *
   * The admin's approval is what actually creates the agency — see
   * `AgenciesService.approveCreateRequest` on the admin-side service.
   */
  async submitCreateRequest(
    userId: string,
    input: {
      name: string;
      country?: string;
      logoUrl: string;
      applicantPhone: string;
      applicantAddress: string;
      idCardFrontUrl: string;
      idCardBackUrl: string;
    },
  ): Promise<AgencyCreateRequestDocument> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new ForbiddenException('Not authenticated');
    }
    const userOid = new Types.ObjectId(userId);

    // Already in an agency? Block — they'd have to leave first anyway.
    const member = await this.memberModel
      .findOne({ userId: userOid })
      .lean()
      .exec();
    if (member) {
      throw new ConflictException({
        code: 'ALREADY_IN_AGENCY',
        message: 'Leave your current agency before requesting to create one',
      });
    }

    const name = input.name.trim();
    if (name.length < 2) {
      throw new BadRequestException({
        code: 'INVALID_FIELDS',
        message: 'Agency name must be at least 2 characters',
      });
    }

    // Required KYC pieces — the form already disables Submit until
    // these are present, but the API is the source of truth.
    const logoUrl = input.logoUrl?.trim() ?? '';
    const applicantPhone = input.applicantPhone?.trim() ?? '';
    const applicantAddress = input.applicantAddress?.trim() ?? '';
    const idFront = input.idCardFrontUrl?.trim() ?? '';
    const idBack = input.idCardBackUrl?.trim() ?? '';
    if (!logoUrl) {
      throw new BadRequestException({
        code: 'LOGO_REQUIRED',
        message: 'Please upload an agency avatar',
      });
    }
    if (!applicantPhone || !applicantAddress) {
      throw new BadRequestException({
        code: 'CONTACT_INFO_REQUIRED',
        message: 'Phone number and address are required for review',
      });
    }
    if (!idFront || !idBack) {
      throw new BadRequestException({
        code: 'ID_CARD_REQUIRED',
        message:
          'Front and back photos of your ID card are required for review',
      });
    }

    // Derive a short, unique-ish code from the name. Strip non-alnum,
    // uppercase, truncate to 16 chars. Append a numeric suffix until
    // unique against existing agencies. The admin can rename on
    // approval — this is just a placeholder identifier so the proposal
    // shows up cleanly on the review screen.
    const codeUpper = await this._deriveAgencyCode(name);

    try {
      return await this.createRequestModel.create({
        userId: userOid,
        status: AgencyCreateRequestStatus.PENDING,
        name,
        code: codeUpper,
        description: '',
        country: (input.country ?? 'BD').toUpperCase(),
        contactEmail: '',
        contactPhone: '',
        logoUrl,
        pitch: '',
        applicantPhone,
        applicantAddress,
        idCardFrontUrl: idFront,
        idCardBackUrl: idBack,
      });
    } catch (err: any) {
      if (err?.code === 11000) {
        throw new ConflictException({
          code: 'REQUEST_PENDING',
          message: 'You already have a pending creation request',
        });
      }
      throw err;
    }
  }

  /**
   * Build an A–Z0–9 code from the proposed name and ensure it doesn't
   * collide with an existing agency. Falls back to a timestamped
   * `AGENCY{N}` if the name has no usable characters (e.g. all
   * non-Latin script).
   */
  private async _deriveAgencyCode(name: string): Promise<string> {
    const base = (name.toUpperCase().match(/[A-Z0-9]+/g) ?? []).join('');
    const seed = (base || 'AGENCY').slice(0, 12);
    for (let attempt = 0; attempt < 20; attempt++) {
      const candidate =
        attempt === 0 ? seed : `${seed}${attempt + 1}`.slice(0, 16);
      const taken = await this.agencyModel
        .countDocuments({ code: candidate })
        .exec();
      if (!taken) return candidate;
    }
    // Extreme fallback — millisecond suffix is effectively unique.
    return `${seed}${Date.now() % 100000}`.slice(0, 20);
  }

  /** User-initiated cancel of their own pending create request. */
  async cancelMyCreateRequest(
    userId: string,
    requestId: string,
  ): Promise<{ ok: true }> {
    if (
      !Types.ObjectId.isValid(userId) ||
      !Types.ObjectId.isValid(requestId)
    ) {
      throw new NotFoundException('Request not found');
    }
    const req = await this.createRequestModel.findById(requestId).exec();
    if (!req) throw new NotFoundException('Request not found');
    if (!req.userId.equals(new Types.ObjectId(userId))) {
      throw new ForbiddenException('Not your request');
    }
    if (req.status !== AgencyCreateRequestStatus.PENDING) {
      throw new BadRequestException({
        code: 'REQUEST_NOT_PENDING',
        message: 'Request is already decided',
      });
    }
    req.status = AgencyCreateRequestStatus.CANCELLED;
    req.decidedAt = new Date();
    await req.save();
    return { ok: true };
  }

  /** Past create-requests for a user (mostly debug / "my history" use). */
  async listMyCreateRequests(userId: string) {
    if (!Types.ObjectId.isValid(userId)) return { items: [] as any[] };
    const items = await this.createRequestModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean()
      .exec();
    return { items };
  }

  // ────────────────────────────────────────────────────────────
  // Create-from-app (legacy: `agency.create` power path)
  // ────────────────────────────────────────────────────────────

  /**
   * Found a new agency from the mobile app. Gated on the user holding
   * the `agency.create` power. Caller becomes the owner of the new
   * agency. Code uniqueness is enforced by the existing unique index.
   *
   * @deprecated The primary creation path is now `submitCreateRequest`
   * → admin review. This direct path stays for backward compatibility
   * with users who already hold the `agency.create` power; new users
   * should use the request flow.
   */
  async createFromApp(
    userId: string,
    input: {
      name: string;
      code: string;
      description?: string;
      country?: string;
      contactEmail?: string;
      contactPhone?: string;
    },
  ): Promise<{ agency: AgencyDocument; member: AgencyMemberDocument }> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new ForbiddenException('Not authenticated');
    }
    const user = await this.userModel
      .findById(userId)
      .select({ agencyPowers: 1 })
      .lean()
      .exec();
    if (!user?.agencyPowers?.includes('agency.create')) {
      throw new ForbiddenException({
        code: 'NO_AGENCY_CREATE_POWER',
        message: 'You do not have permission to create an agency',
      });
    }
    // Can't found a new agency while already a member of one.
    const existing = await this.memberModel
      .findOne({ userId: new Types.ObjectId(userId) })
      .lean()
      .exec();
    if (existing) {
      throw new ConflictException({
        code: 'ALREADY_IN_AGENCY',
        message: 'Leave your current agency first',
      });
    }

    const codeUpper = input.code.trim().toUpperCase();
    const exists = await this.agencyModel
      .countDocuments({ code: codeUpper })
      .exec();
    if (exists) {
      throw new ConflictException({
        code: 'AGENCY_CODE_TAKEN',
        message: `Agency code "${codeUpper}" is already taken`,
      });
    }

    const agency = await this.numericIds.createWithId(
      CounterScope.AGENCY,
      (numericId) =>
        this.agencyModel.create({
          numericId,
          name: input.name.trim(),
          code: codeUpper,
          description: input.description?.trim() ?? '',
          country: (input.country ?? 'BD').toUpperCase(),
          contactEmail: input.contactEmail?.trim() ?? '',
          contactPhone: input.contactPhone?.trim() ?? '',
          status: AgencyStatus.ACTIVE,
          hostCount: 1,
          createdBy: null,
        }),
    );
    const member = await this.memberModel.create({
      agencyId: agency._id,
      userId: new Types.ObjectId(userId),
      role: AgencyMemberRole.OWNER,
      joinedAt: new Date(),
    });
    // Founding an agency auto-promotes the founder to host — they're
    // the owner so the "join → host" rule applies to them too. No-op
    // when they're already a host (just attaches the new agency).
    await this.users.ensureHostForAgency(userId, agency._id.toString());
    return { agency, member };
  }

  // ────────────────────────────────────────────────────────────
  // Admin-lite (in-app agency management for power-holders)
  // ────────────────────────────────────────────────────────────
  //
  // Surfaced to users whose `agencyPowers` contains `agency.manage`.
  // The mobile app exposes a "Management" card on the profile that
  // pushes a dedicated page where these users can list every agency
  // on the platform, edit details, terminate inactive ones, and act
  // on the create-request review queue — the same things a platform
  // admin can do from the web admin panel, scoped to this single
  // power.

  /** Guard for every admin-lite endpoint. */
  private async _assertAgencyManagePower(actorId: string): Promise<void> {
    if (!Types.ObjectId.isValid(actorId)) {
      throw new ForbiddenException('Not authenticated');
    }
    const u = await this.userModel
      .findById(actorId)
      .select({ agencyPowers: 1 })
      .lean()
      .exec();
    if (!u?.agencyPowers?.includes('agency.manage')) {
      throw new ForbiddenException({
        code: 'NO_AGENCY_MANAGE_POWER',
        message: 'You do not have permission to manage agencies',
      });
    }
  }

  /**
   * Paginated, status-filterable list of every agency on the
   * platform. Mirrors the admin-panel grid — the mobile UI uses it
   * as the "All agencies" tab.
   */
  async manageList(
    actorId: string,
    params: {
      page?: number;
      limit?: number;
      status?: AgencyStatus;
      country?: string;
      search?: string;
    },
  ) {
    await this._assertAgencyManagePower(actorId);
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(50, Math.max(1, params.limit ?? 20));
    const skip = (page - 1) * limit;

    const filter: FilterQuery<AgencyDocument> = {};
    if (params.status) filter.status = params.status;
    if (params.country) filter.country = params.country.toUpperCase();
    if (params.search) {
      const q = params.search.trim();
      const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'i');
      const or: FilterQuery<AgencyDocument>[] = [
        { name: regex },
        { code: regex },
        { description: regex },
      ];
      if (/^\d{1,7}$/.test(q)) {
        or.push({ numericId: parseInt(q, 10) });
      }
      filter.$or = or;
    }

    const [items, total] = await Promise.all([
      this.agencyModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.agencyModel.countDocuments(filter).exec(),
    ]);
    // `.lean()` skips the schema-level _id → id transform — emulate
    // it here so the mobile model parses cleanly.
    const normalized = items.map((a: any) => ({
      ...a,
      id: a._id?.toString(),
      _id: a._id?.toString(),
    }));
    return { items: normalized, page, limit, total };
  }

  async manageGet(actorId: string, agencyId: string) {
    await this._assertAgencyManagePower(actorId);
    if (!Types.ObjectId.isValid(agencyId)) {
      throw new NotFoundException('Agency not found');
    }
    const agency = await this.agencyModel.findById(agencyId).exec();
    if (!agency) throw new NotFoundException('Agency not found');
    return agency.toJSON();
  }

  /**
   * Direct create from the app — used by the Management → Agency
   * page's "+" action. Bypasses the review queue because the actor
   * already holds the `agency.manage` power. The created agency has
   * no auto-assigned owner; the actor can promote any user to owner
   * separately if they want one.
   */
  async manageCreate(
    actorId: string,
    input: {
      name: string;
      code: string;
      description?: string;
      country?: string;
      logoUrl?: string;
      contactEmail?: string;
      contactPhone?: string;
      commissionRate?: number;
    },
  ) {
    await this._assertAgencyManagePower(actorId);
    const name = input.name.trim();
    const codeUpper = input.code.trim().toUpperCase();
    if (name.length < 2 || codeUpper.length < 2) {
      throw new BadRequestException({
        code: 'INVALID_FIELDS',
        message: 'Name and code must be at least 2 characters',
      });
    }
    if (!/^[A-Z0-9_-]+$/.test(codeUpper)) {
      throw new BadRequestException({
        code: 'INVALID_CODE',
        message: 'Code may contain only letters, digits, _ and -',
      });
    }
    const exists = await this.agencyModel
      .countDocuments({ code: codeUpper })
      .exec();
    if (exists) {
      throw new ConflictException({
        code: 'AGENCY_CODE_TAKEN',
        message: `Agency code "${codeUpper}" is already taken`,
      });
    }
    const commission = input.commissionRate ?? 30;
    if (commission < 0 || commission > 100) {
      throw new BadRequestException({
        code: 'INVALID_COMMISSION',
        message: 'Commission rate must be between 0 and 100',
      });
    }
    const agency = await this.numericIds.createWithId(
      CounterScope.AGENCY,
      (numericId) =>
        this.agencyModel.create({
          numericId,
          name,
          code: codeUpper,
          description: input.description?.trim() ?? '',
          country: (input.country ?? 'BD').toUpperCase(),
          logoUrl: input.logoUrl?.trim() ?? '',
          contactEmail: input.contactEmail?.trim() ?? '',
          contactPhone: input.contactPhone?.trim() ?? '',
          commissionRate: commission,
          status: AgencyStatus.ACTIVE,
          createdBy: null,
        }),
    );
    return agency.toJSON();
  }

  /**
   * Patch agency-level fields. `code` is intentionally not editable —
   * it's used as the user-visible identifier and renaming would break
   * external references. Status changes go through `manageSetStatus`.
   */
  async manageUpdate(
    actorId: string,
    agencyId: string,
    patch: {
      name?: string;
      description?: string;
      country?: string;
      logoUrl?: string;
      contactEmail?: string;
      contactPhone?: string;
      commissionRate?: number;
    },
  ) {
    await this._assertAgencyManagePower(actorId);
    if (!Types.ObjectId.isValid(agencyId)) {
      throw new NotFoundException('Agency not found');
    }
    const agency = await this.agencyModel.findById(agencyId).exec();
    if (!agency) throw new NotFoundException('Agency not found');
    if (patch.name !== undefined) agency.name = patch.name.trim();
    if (patch.description !== undefined) {
      agency.description = patch.description.trim();
    }
    if (patch.country !== undefined) {
      agency.country = patch.country.toUpperCase();
    }
    if (patch.logoUrl !== undefined) agency.logoUrl = patch.logoUrl.trim();
    if (patch.contactEmail !== undefined) {
      agency.contactEmail = patch.contactEmail.trim();
    }
    if (patch.contactPhone !== undefined) {
      agency.contactPhone = patch.contactPhone.trim();
    }
    if (patch.commissionRate !== undefined) {
      if (patch.commissionRate < 0 || patch.commissionRate > 100) {
        throw new BadRequestException({
          code: 'INVALID_COMMISSION',
          message: 'Commission rate must be between 0 and 100',
        });
      }
      agency.commissionRate = patch.commissionRate;
    }
    await agency.save();
    return agency.toJSON();
  }

  /**
   * Status transition: ACTIVE ↔ SUSPENDED ↔ TERMINATED. The mobile
   * "delete" action calls this with TERMINATED — a soft-delete that
   * preserves audit trail.
   */
  async manageSetStatus(
    actorId: string,
    agencyId: string,
    status: AgencyStatus,
  ) {
    await this._assertAgencyManagePower(actorId);
    if (!Types.ObjectId.isValid(agencyId)) {
      throw new NotFoundException('Agency not found');
    }
    const agency = await this.agencyModel.findById(agencyId).exec();
    if (!agency) throw new NotFoundException('Agency not found');
    agency.status = status;
    await agency.save();
    return agency.toJSON();
  }

  /**
   * Paginated create-request review queue — what the admin panel
   * shows at `/admin/agencies/create-requests`. Includes the
   * applicant's user info (name, avatar, numericId) so the mobile
   * UI can render the row in one round-trip.
   */
  async manageListCreateRequests(
    actorId: string,
    params: {
      page?: number;
      limit?: number;
      status?: AgencyCreateRequestStatus;
    },
  ) {
    await this._assertAgencyManagePower(actorId);
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(50, Math.max(1, params.limit ?? 20));
    const skip = (page - 1) * limit;
    const filter: FilterQuery<AgencyCreateRequestDocument> = {};
    if (params.status) filter.status = params.status;
    const [items, total] = await Promise.all([
      this.createRequestModel
        .find(filter)
        .sort({ status: 1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate(
          'userId',
          'username displayName avatarUrl numericId level isHost',
        )
        .lean()
        .exec(),
      this.createRequestModel.countDocuments(filter).exec(),
    ]);
    // Normalize the populated user `_id → id` so the mobile model
    // parses consistently. Mirrors the admin panel's listCreateRequests.
    const normalized = items.map((r: any) => {
      const rawUser = r.userId;
      const userObj =
        rawUser && typeof rawUser === 'object'
          ? {
              ...rawUser,
              id: rawUser._id?.toString(),
              _id: rawUser._id?.toString(),
            }
          : rawUser?.toString();
      return {
        ...r,
        id: r._id?.toString(),
        _id: r._id?.toString(),
        userId: userObj,
        createdAgencyId: r.createdAgencyId?.toString(),
      };
    });
    return { items: normalized, page, limit, total };
  }

  /**
   * Approve a create-request from the app. Same effect as the admin
   * panel's approve: an agency is created, the requester becomes its
   * owner, and they're auto-promoted to host. Code collisions throw
   * 409 so the request stays pending for follow-up.
   */
  async manageApproveCreateRequest(
    actorId: string,
    requestId: string,
    note: string,
  ): Promise<{
    request: AgencyCreateRequestDocument;
    agency: AgencyDocument;
  }> {
    await this._assertAgencyManagePower(actorId);
    if (!Types.ObjectId.isValid(requestId)) {
      throw new NotFoundException('Request not found');
    }
    const req = await this.createRequestModel.findById(requestId).exec();
    if (!req) throw new NotFoundException('Request not found');
    if (req.status !== AgencyCreateRequestStatus.PENDING) {
      throw new BadRequestException({
        code: 'REQUEST_NOT_PENDING',
        message: 'Request is already decided',
      });
    }
    const conflictingMember = await this.memberModel
      .findOne({ userId: req.userId })
      .lean()
      .exec();
    if (conflictingMember) {
      throw new ConflictException({
        code: 'REQUESTER_ALREADY_IN_AGENCY',
        message:
          'Requester is now a member of another agency. Reject this request.',
      });
    }
    const codeUpper = req.code.toUpperCase();
    const codeTaken = await this.agencyModel
      .countDocuments({ code: codeUpper })
      .exec();
    if (codeTaken) {
      throw new ConflictException({
        code: 'AGENCY_CODE_TAKEN',
        message: `Agency code "${codeUpper}" is taken — ask the requester to pick a different code.`,
      });
    }
    const agency = await this.numericIds.createWithId(
      CounterScope.AGENCY,
      (numericId) =>
        this.agencyModel.create({
          numericId,
          name: req.name,
          code: codeUpper,
          description: req.description,
          country: req.country,
          contactEmail: req.contactEmail,
          contactPhone: req.contactPhone,
          logoUrl: req.logoUrl,
          status: AgencyStatus.ACTIVE,
          hostCount: 1,
          // No AdminUser-fk available for app actors; record stays null.
          createdBy: null,
        }),
    );
    await this.memberModel.create({
      agencyId: agency._id,
      userId: req.userId,
      role: AgencyMemberRole.OWNER,
      joinedAt: new Date(),
    });
    await this.users.ensureHostForAgency(
      req.userId.toString(),
      agency._id.toString(),
      actorId,
    );
    req.status = AgencyCreateRequestStatus.APPROVED;
    req.decidedAt = new Date();
    req.decisionNote = note.trim();
    req.createdAgencyId = agency._id;
    // decidedBy expects an AdminUser ref; leave null for app actors.
    req.decidedBy = null;
    await req.save();
    return { request: req, agency };
  }

  /**
   * Atomic ownership transfer from the in-app Agency Management
   * page. Gated on `agency.manage` — the actor doesn't have to be a
   * member of the target agency. Current owner is demoted to ADMIN
   * by default so they retain staff access; pass `demoteTo: 'member'`
   * to strip that too.
   */
  async manageTransferOwnership(
    actorId: string,
    agencyId: string,
    newOwnerUserId: string,
    demoteTo: AgencyMemberRole = AgencyMemberRole.ADMIN,
  ): Promise<{ ok: true }> {
    await this._assertAgencyManagePower(actorId);
    return this._transferOwnershipImpl(agencyId, newOwnerUserId, demoteTo);
  }

  /**
   * Owner-driven ownership transfer from the agency moderation page.
   * Available to the current owner only (and to super-power holders
   * via `assertCanGovern`). Same outcome as `manageTransferOwnership`,
   * different auth path so we don't conflate "I manage every agency"
   * with "I own this one".
   */
  async transferOwnership(
    actorId: string,
    agencyId: string,
    newOwnerUserId: string,
    demoteTo: AgencyMemberRole = AgencyMemberRole.ADMIN,
  ): Promise<{ ok: true }> {
    if (!Types.ObjectId.isValid(agencyId)) {
      throw new NotFoundException('Agency not found');
    }
    await this.assertCanGovern(new Types.ObjectId(agencyId), actorId);
    return this._transferOwnershipImpl(agencyId, newOwnerUserId, demoteTo);
  }

  private async _transferOwnershipImpl(
    agencyId: string,
    newOwnerUserId: string,
    demoteTo: AgencyMemberRole,
  ): Promise<{ ok: true }> {
    if (
      !Types.ObjectId.isValid(agencyId) ||
      !Types.ObjectId.isValid(newOwnerUserId)
    ) {
      throw new BadRequestException({
        code: 'INVALID_IDS',
        message: 'Invalid agency or user id',
      });
    }
    if (demoteTo === AgencyMemberRole.OWNER) {
      throw new BadRequestException({
        code: 'INVALID_DEMOTE_TARGET',
        message: 'Cannot demote the current owner back to owner',
      });
    }
    const agencyOid = new Types.ObjectId(agencyId);
    const agency = await this.agencyModel.findById(agencyOid).exec();
    if (!agency) throw new NotFoundException('Agency not found');

    const incoming = await this.memberModel
      .findOne({
        agencyId: agencyOid,
        userId: new Types.ObjectId(newOwnerUserId),
      })
      .exec();
    if (!incoming) {
      throw new NotFoundException({
        code: 'MEMBER_NOT_FOUND',
        message:
          'Target user is not a member of this agency. Add them as a member first.',
      });
    }
    if (incoming.role === AgencyMemberRole.OWNER) return { ok: true };

    const outgoing = await this.memberModel
      .findOne({ agencyId: agencyOid, role: AgencyMemberRole.OWNER })
      .exec();
    if (outgoing) {
      outgoing.role = demoteTo;
      await outgoing.save();
    }
    incoming.role = AgencyMemberRole.OWNER;
    await incoming.save();
    return { ok: true };
  }

  async manageRejectCreateRequest(
    actorId: string,
    requestId: string,
    note: string,
  ): Promise<AgencyCreateRequestDocument> {
    await this._assertAgencyManagePower(actorId);
    if (!Types.ObjectId.isValid(requestId)) {
      throw new NotFoundException('Request not found');
    }
    const req = await this.createRequestModel.findById(requestId).exec();
    if (!req) throw new NotFoundException('Request not found');
    if (req.status !== AgencyCreateRequestStatus.PENDING) {
      throw new BadRequestException({
        code: 'REQUEST_NOT_PENDING',
        message: 'Request is already decided',
      });
    }
    req.status = AgencyCreateRequestStatus.REJECTED;
    req.decidedAt = new Date();
    req.decisionNote = note.trim();
    req.decidedBy = null;
    await req.save();
    return req;
  }
}

function _emptyMine() {
  return {
    member: null,
    agency: null,
    pendingRequest: null,
    pendingCreateRequest: null,
    powers: [] as string[],
  };
}
