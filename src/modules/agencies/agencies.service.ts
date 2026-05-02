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
}
