import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';

import { AuthenticatedAdmin } from '../admin/admin-auth/strategies/admin-jwt.strategy';
import { NumericIdService } from '../common/numeric-id.service';
import { CounterScope } from '../common/schemas/counter.schema';
import { SystemConfigService } from '../system-config/system-config.service';
import { UsersService } from '../users/users.service';
import {
  AgencyCreateRequest,
  AgencyCreateRequestDocument,
  AgencyCreateRequestStatus,
} from './schemas/agency-create-request.schema';
import {
  AgencyMember,
  AgencyMemberDocument,
  AgencyMemberRole,
} from './schemas/agency-member.schema';
import { Agency, AgencyDocument, AgencyStatus } from './schemas/agency.schema';

interface ListAgenciesParams {
  page?: number;
  limit?: number;
  status?: AgencyStatus;
  country?: string;
  search?: string;
}

interface CreateAgencyInput {
  name: string;
  code: string;
  description?: string;
  country?: string;
  logoUrl?: string;
  contactEmail?: string;
  contactPhone?: string;
  commissionRate?: number;
  createdBy?: string;
}

@Injectable()
export class AgenciesService {
  constructor(
    @InjectModel(Agency.name) private readonly agencyModel: Model<AgencyDocument>,
    @InjectModel(AgencyMember.name)
    private readonly memberModel: Model<AgencyMemberDocument>,
    @InjectModel(AgencyCreateRequest.name)
    private readonly createRequestModel: Model<AgencyCreateRequestDocument>,
    private readonly users: UsersService,
    private readonly numericIds: NumericIdService,
    private readonly config: SystemConfigService,
  ) {}

  /**
   * Hard kill switch — admin sets `agenciesEnabled: false` in system config
   * to stop accepting new agencies / host assignments without redeploying.
   * Existing agencies keep operating; reads stay open.
   */
  private async assertFeatureEnabled(): Promise<void> {
    if (!(await this.config.agenciesEnabled())) {
      throw new ForbiddenException({
        code: 'AGENCY_FEATURE_DISABLED',
        message: 'The agency feature is currently disabled.',
      });
    }
  }

  /**
   * Builds a Mongo filter that limits results to the admin's scope.
   * Global admins → no filter (see everything).
   * Agency admins → can only access their own agency document.
   */
  private scopeFilter(admin: AuthenticatedAdmin): FilterQuery<AgencyDocument> {
    if (admin.scopeType === 'agency' && admin.scopeId) {
      return { _id: new Types.ObjectId(admin.scopeId) };
    }
    return {};
  }

  /**
   * Asserts a scoped admin can access this specific agency. Returns the agency
   * or throws 404 (we deliberately don't leak existence to other-scope admins).
   */
  private async findOneOr404(
    id: string,
    admin: AuthenticatedAdmin,
  ): Promise<AgencyDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Agency not found');
    }
    // Scope check FIRST — don't leak any data to out-of-scope admins.
    if (admin.scopeType === 'agency' && admin.scopeId && admin.scopeId !== id) {
      throw new NotFoundException('Agency not found');
    }
    const agency = await this.agencyModel.findById(id).exec();
    if (!agency) throw new NotFoundException('Agency not found');
    return agency;
  }

  // ---------------- CRUD ----------------

  async list(params: ListAgenciesParams, admin: AuthenticatedAdmin) {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(100, Math.max(1, params.limit ?? 20));
    const skip = (page - 1) * limit;

    const filter: FilterQuery<AgencyDocument> = { ...this.scopeFilter(admin) };
    if (params.status) filter.status = params.status;
    if (params.country) filter.country = params.country.toUpperCase();
    if (params.search) {
      const escaped = params.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'i');
      const or: FilterQuery<AgencyDocument>[] = [
        { name: regex },
        { code: regex },
        { description: regex },
      ];
      if (/^\d{1,7}$/.test(params.search.trim())) {
        or.push({ numericId: parseInt(params.search.trim(), 10) });
      }
      filter.$or = or;
    }

    const [items, total] = await Promise.all([
      this.agencyModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).exec(),
      this.agencyModel.countDocuments(filter).exec(),
    ]);

    return { items, page, limit, total };
  }

  async findById(id: string, admin: AuthenticatedAdmin): Promise<AgencyDocument> {
    return this.findOneOr404(id, admin);
  }

  async create(input: CreateAgencyInput): Promise<AgencyDocument> {
    await this.assertFeatureEnabled();
    const codeUpper = input.code.toUpperCase();
    const exists = await this.agencyModel.countDocuments({ code: codeUpper }).exec();
    if (exists) {
      throw new ConflictException({
        code: 'AGENCY_CODE_TAKEN',
        message: `Agency code "${codeUpper}" already in use`,
      });
    }
    return this.numericIds.createWithId(CounterScope.AGENCY, (numericId) =>
      this.agencyModel.create({
        numericId,
        name: input.name,
        code: codeUpper,
        description: input.description ?? '',
        country: (input.country ?? 'BD').toUpperCase(),
        logoUrl: input.logoUrl ?? '',
        contactEmail: input.contactEmail ?? '',
        contactPhone: input.contactPhone ?? '',
        commissionRate: input.commissionRate ?? 30,
        status: AgencyStatus.ACTIVE,
        createdBy: input.createdBy ? new Types.ObjectId(input.createdBy) : null,
      }),
    );
  }

  async update(
    id: string,
    update: Partial<CreateAgencyInput>,
    admin: AuthenticatedAdmin,
  ): Promise<AgencyDocument> {
    const agency = await this.findOneOr404(id, admin);

    if (update.name !== undefined) agency.name = update.name;
    if (update.description !== undefined) agency.description = update.description;
    if (update.country !== undefined) agency.country = update.country.toUpperCase();
    if (update.logoUrl !== undefined) agency.logoUrl = update.logoUrl;
    if (update.contactEmail !== undefined) agency.contactEmail = update.contactEmail;
    if (update.contactPhone !== undefined) agency.contactPhone = update.contactPhone;
    if (update.commissionRate !== undefined) agency.commissionRate = update.commissionRate;

    await agency.save();
    return agency;
  }

  async updateStatus(
    id: string,
    status: AgencyStatus,
    admin: AuthenticatedAdmin,
  ): Promise<AgencyDocument> {
    // Scoped admins cannot change their own agency's status.
    if (admin.scopeType === 'agency') {
      throw new ForbiddenException({
        code: 'SCOPED_CANNOT_CHANGE_STATUS',
        message: 'Agency admins cannot change their own agency status',
      });
    }
    const agency = await this.findOneOr404(id, admin);
    agency.status = status;
    await agency.save();
    return agency;
  }

  // ---------------- Hosts assignment ----------------

  async listHosts(
    id: string,
    params: { page?: number; limit?: number; search?: string },
    admin: AuthenticatedAdmin,
  ) {
    const agency = await this.findOneOr404(id, admin);
    return this.users.list({
      page: params.page,
      limit: params.limit,
      search: params.search,
      isHost: true,
      // Filter by hostProfile.agencyId — extending UsersService:
      ...(({ agencyId: agency._id.toString() } as any) as Record<string, unknown>),
    });
  }

  async assignHost(
    id: string,
    userId: string,
    admin: AuthenticatedAdmin,
  ): Promise<AgencyDocument> {
    await this.assertFeatureEnabled();
    // Only global admins can assign — agency admins can request via separate flow.
    if (admin.scopeType === 'agency' && admin.scopeId !== id) {
      throw new ForbiddenException({
        code: 'OUT_OF_SCOPE',
        message: 'Cannot assign hosts to a different agency',
      });
    }

    const agency = await this.findOneOr404(id, admin);
    const user = await this.users.getByIdOrThrow(userId);

    if (!user.isHost) {
      throw new BadRequestException({
        code: 'USER_NOT_HOST',
        message: 'User must be a host before being assigned to an agency',
      });
    }

    const previousAgencyId = user.hostProfile?.agencyId
      ? user.hostProfile.agencyId.toString()
      : null;

    if (previousAgencyId === agency._id.toString()) return agency;

    // Update user's hostProfile.agencyId
    await this.users.setHost(userId, true, {
      tier: user.hostProfile?.tier as any,
      agencyId: agency._id.toString(),
    });

    // Update counters (decrement old agency if any, increment new)
    if (previousAgencyId && Types.ObjectId.isValid(previousAgencyId)) {
      await this.agencyModel
        .updateOne({ _id: previousAgencyId }, { $inc: { hostCount: -1 } })
        .exec();
    }
    await this.agencyModel.updateOne({ _id: agency._id }, { $inc: { hostCount: 1 } }).exec();
    return (await this.agencyModel.findById(agency._id).exec())!;
  }

  async unassignHost(
    id: string,
    userId: string,
    admin: AuthenticatedAdmin,
  ): Promise<AgencyDocument> {
    const agency = await this.findOneOr404(id, admin);
    const user = await this.users.getByIdOrThrow(userId);

    if (!user.hostProfile?.agencyId || user.hostProfile.agencyId.toString() !== agency._id.toString()) {
      throw new BadRequestException({
        code: 'NOT_IN_AGENCY',
        message: 'User is not a host in this agency',
      });
    }

    await this.users.setHost(userId, true, {
      tier: user.hostProfile.tier as any,
      agencyId: null,
    });
    await this.agencyModel.updateOne({ _id: agency._id }, { $inc: { hostCount: -1 } }).exec();
    return (await this.agencyModel.findById(agency._id).exec())!;
  }

  /** Used by AdminUsers when an admin is created with `agency` scope. */
  async exists(id: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(id)) return false;
    return (await this.agencyModel.countDocuments({ _id: id }).exec()) > 0;
  }

  // ---------------- App-side agency members (admin panel) ----------------
  //
  // App users join an agency by sending a join request from the mobile
  // app, which is then approved by the agency owner / admin. Platform
  // admins can also drop a user straight into an agency from here — useful
  // for onboarding agencies that came in via offline contracts.

  /**
   * Roster for the admin panel. Hydrates each member with the linked
   * user's display info so the table can show name + numericId + avatar
   * without a follow-up call per row.
   */
  async listMembers(
    id: string,
    params: { page?: number; limit?: number },
    admin: AuthenticatedAdmin,
  ) {
    const agency = await this.findOneOr404(id, admin);
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(100, Math.max(1, params.limit ?? 50));
    const skip = (page - 1) * limit;
    const [rawItems, total] = await Promise.all([
      this.memberModel
        .find({ agencyId: agency._id })
        .sort({ role: 1, joinedAt: 1 })
        .skip(skip)
        .limit(limit)
        .populate(
          'userId',
          'username displayName avatarUrl numericId level isHost',
        )
        .lean()
        .exec(),
      this.memberModel.countDocuments({ agencyId: agency._id }).exec(),
    ]);
    // `.lean()` skips the schema-level `_id → id` transform, so the
    // populated user comes back with `_id` and the admin panel's table
    // (which reads `user.id`) sends `undefined` back into our delete /
    // role-change endpoints. Normalize here so every consumer sees the
    // same shape regardless of the query mode underneath.
    const items = rawItems.map((m: any) => {
      const rawUser = m.userId;
      const userObj =
        rawUser && typeof rawUser === 'object'
          ? {
              ...rawUser,
              id: rawUser._id?.toString(),
              _id: rawUser._id?.toString(),
            }
          : rawUser?.toString();
      return {
        ...m,
        id: m._id?.toString(),
        _id: m._id?.toString(),
        agencyId: m.agencyId?.toString(),
        userId: userObj,
      };
    });
    return { items, page, limit, total };
  }

  /**
   * Add an app user to the agency with the given role. Upserts so the
   * same call can both promote an existing member ("flip member → admin")
   * and seed a new one. Owners are unique per agency — assigning a new
   * owner demotes the previous one to admin.
   */
  async addMember(
    id: string,
    userId: string,
    role: AgencyMemberRole,
    admin: AuthenticatedAdmin,
  ): Promise<AgencyMemberDocument> {
    await this.assertFeatureEnabled();
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException({
        code: 'INVALID_USER_ID',
        message: 'Invalid user id',
      });
    }
    const agency = await this.findOneOr404(id, admin);
    // The user must actually exist — surfaces a clearer 404 than a
    // foreign-key error from the upsert.
    await this.users.getByIdOrThrow(userId);

    const userOid = new Types.ObjectId(userId);
    // Already a member of another agency? Reject — one-agency-at-a-time
    // is enforced by the unique index on `userId` anyway, but we want a
    // human-readable error.
    const conflicting = await this.memberModel
      .findOne({ userId: userOid })
      .lean()
      .exec();
    if (conflicting && !conflicting.agencyId.equals(agency._id)) {
      throw new ConflictException({
        code: 'ALREADY_IN_OTHER_AGENCY',
        message:
          'This user is already a member of another agency. Remove them there first.',
      });
    }

    // Owner is exclusive. If we're assigning a new owner and one
    // already exists, demote the incumbent to admin so the invariant
    // holds.
    if (role === AgencyMemberRole.OWNER) {
      await this.memberModel
        .updateMany(
          {
            agencyId: agency._id,
            role: AgencyMemberRole.OWNER,
            userId: { $ne: userOid },
          },
          { $set: { role: AgencyMemberRole.ADMIN } },
        )
        .exec();
    }

    const isInsert = !conflicting;
    const member = await this.memberModel
      .findOneAndUpdate(
        { agencyId: agency._id, userId: userOid },
        {
          $set: { role },
          $setOnInsert: { joinedAt: new Date() },
        },
        { new: true, upsert: true },
      )
      .exec();
    // Counter — only bump on a true insert.
    if (isInsert) {
      await this.agencyModel
        .updateOne({ _id: agency._id }, { $inc: { hostCount: 1 } })
        .exec();
    }
    // Joining an agency auto-promotes to host (Trainee tier) — same
    // rule the mobile join-approve path enforces, applied here so an
    // admin-side `Add member` doesn't bypass it. No-op when the user
    // is already a host (only patches `hostProfile.agencyId`).
    await this.users.ensureHostForAgency(
      userOid.toString(),
      agency._id.toString(),
      admin.adminId,
    );
    return member;
  }

  /**
   * Remove an app user from the agency. Refuses to remove the lone
   * owner — admin must transfer ownership first (i.e., promote someone
   * else to owner, which demotes the incumbent automatically).
   */
  async removeMember(
    id: string,
    userId: string,
    admin: AuthenticatedAdmin,
  ): Promise<{ ok: true }> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException({
        code: 'INVALID_USER_ID',
        message: 'Invalid user id',
      });
    }
    const agency = await this.findOneOr404(id, admin);
    const target = await this.memberModel
      .findOne({ agencyId: agency._id, userId: new Types.ObjectId(userId) })
      .exec();
    if (!target) {
      throw new NotFoundException({
        code: 'MEMBER_NOT_FOUND',
        message: 'This user is not a member of the agency',
      });
    }
    if (target.role === AgencyMemberRole.OWNER) {
      const otherOwners = await this.memberModel
        .countDocuments({
          agencyId: agency._id,
          role: AgencyMemberRole.OWNER,
          _id: { $ne: target._id },
        })
        .exec();
      if (otherOwners === 0) {
        throw new BadRequestException({
          code: 'CANNOT_REMOVE_LONE_OWNER',
          message:
            'Transfer ownership to another member before removing this user',
        });
      }
    }
    await this.memberModel.deleteOne({ _id: target._id }).exec();
    await this.agencyModel
      .updateOne(
        { _id: agency._id, hostCount: { $gt: 0 } },
        { $inc: { hostCount: -1 } },
      )
      .exec();
    return { ok: true };
  }

  // ---------------- Agency creation requests (admin review) ----------------

  async listCreateRequests(params: {
    page?: number;
    limit?: number;
    status?: AgencyCreateRequestStatus;
  }) {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(100, Math.max(1, params.limit ?? 20));
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
    // Normalize the populated user `_id → id` so the admin panel can
    // read consistent shapes (same fix the members list got).
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
   * Approve an agency-creation request: creates the agency, makes the
   * requester its owner, auto-promotes them to host. All-or-nothing —
   * if the agency code collides at the unique-index level we throw
   * 409 and the request stays pending so the admin can ask the user
   * to pick a different code.
   */
  async approveCreateRequest(
    requestId: string,
    actorAdminId: string,
    note: string,
  ): Promise<{
    request: AgencyCreateRequestDocument;
    agency: AgencyDocument;
  }> {
    await this.assertFeatureEnabled();
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

    // Re-check membership at decision time — the user might have
    // joined another agency between request submission and approval.
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
          // Proposed logo from the request carries over to the live
          // agency — the admin would've already vetted it during
          // review.
          logoUrl: req.logoUrl,
          status: AgencyStatus.ACTIVE,
          hostCount: 1,
          createdBy: Types.ObjectId.isValid(actorAdminId)
            ? new Types.ObjectId(actorAdminId)
            : null,
        }),
    );

    await this.memberModel.create({
      agencyId: agency._id,
      userId: req.userId,
      role: AgencyMemberRole.OWNER,
      joinedAt: new Date(),
    });

    // Joining an agency makes you a host — apply that rule here too.
    await this.users.ensureHostForAgency(
      req.userId.toString(),
      agency._id.toString(),
      actorAdminId,
    );

    req.status = AgencyCreateRequestStatus.APPROVED;
    req.decidedBy = Types.ObjectId.isValid(actorAdminId)
      ? new Types.ObjectId(actorAdminId)
      : null;
    req.decidedAt = new Date();
    req.decisionNote = note.trim();
    req.createdAgencyId = agency._id;
    await req.save();
    return { request: req, agency };
  }

  async rejectCreateRequest(
    requestId: string,
    actorAdminId: string,
    note: string,
  ): Promise<AgencyCreateRequestDocument> {
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
    req.decidedBy = Types.ObjectId.isValid(actorAdminId)
      ? new Types.ObjectId(actorAdminId)
      : null;
    req.decidedAt = new Date();
    req.decisionNote = note.trim();
    await req.save();
    return req;
  }
}
