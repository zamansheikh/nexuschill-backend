import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';

import { Moment, MomentDocument } from '../moments/schemas/moment.schema';
import { Room, RoomDocument } from '../rooms/schemas/room.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { CreateReportDto } from './dto/create-report.dto';
import { UpdateReportDto } from './dto/update-report.dto';
import {
  ReportReason,
  ReportStatus,
  ReportTargetType,
  UserReport,
  UserReportDocument,
} from './schemas/user-report.schema';

export interface ListReportsParams {
  page?: number;
  limit?: number;
  status?: ReportStatus;
  reason?: ReportReason;
  targetType?: ReportTargetType;
  targetUserId?: string;
}

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    @InjectModel(UserReport.name)
    private readonly reportModel: Model<UserReportDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Room.name) private readonly roomModel: Model<RoomDocument>,
    @InjectModel(Moment.name)
    private readonly momentModel: Model<MomentDocument>,
  ) {}

  /**
   * Create a new report. Validates the target exists, refuses
   * self-reports, and resolves `targetUserId` so the admin queue
   * can sort/group by offender even when the surface is a room or
   * moment. Same reporter/target/reason within an hour collapses
   * to a single row — prevents accidental triple-tap spam without
   * blocking genuine repeated reports days later.
   */
  async create(
    reporterId: string,
    dto: CreateReportDto,
  ): Promise<UserReportDocument> {
    if (!Types.ObjectId.isValid(reporterId)) {
      throw new BadRequestException({
        code: 'INVALID_ID',
        message: 'Invalid id',
      });
    }
    const reporterOid = new Types.ObjectId(reporterId);

    let targetUserId: Types.ObjectId | null = null;

    switch (dto.targetType) {
      case ReportTargetType.USER: {
        if (!Types.ObjectId.isValid(dto.targetId)) {
          throw new BadRequestException({
            code: 'INVALID_TARGET_ID',
            message: 'Invalid target id',
          });
        }
        if (dto.targetId === reporterId) {
          throw new BadRequestException({
            code: 'CANNOT_REPORT_SELF',
            message: 'You cannot report yourself',
          });
        }
        const exists = await this.userModel
          .exists({ _id: new Types.ObjectId(dto.targetId) })
          .exec();
        if (!exists) {
          throw new NotFoundException({
            code: 'TARGET_NOT_FOUND',
            message: 'Reported user not found',
          });
        }
        targetUserId = new Types.ObjectId(dto.targetId);
        break;
      }
      case ReportTargetType.ROOM: {
        if (!Types.ObjectId.isValid(dto.targetId)) {
          throw new BadRequestException({
            code: 'INVALID_TARGET_ID',
            message: 'Invalid target id',
          });
        }
        const room = await this.roomModel
          .findById(dto.targetId)
          .select('ownerId')
          .lean()
          .exec();
        if (!room) {
          throw new NotFoundException({
            code: 'TARGET_NOT_FOUND',
            message: 'Reported room not found',
          });
        }
        targetUserId = (room as any).ownerId ?? null;
        break;
      }
      case ReportTargetType.MOMENT: {
        if (!Types.ObjectId.isValid(dto.targetId)) {
          throw new BadRequestException({
            code: 'INVALID_TARGET_ID',
            message: 'Invalid target id',
          });
        }
        const moment = await this.momentModel
          .findById(dto.targetId)
          .select('authorId')
          .lean()
          .exec();
        if (!moment) {
          throw new NotFoundException({
            code: 'TARGET_NOT_FOUND',
            message: 'Reported moment not found',
          });
        }
        targetUserId = (moment as any).authorId ?? null;
        break;
      }
      case ReportTargetType.MESSAGE: {
        // Messages are ephemeral and not all flow through Mongo, so we
        // accept any string targetId and rely on `meta.roomId` /
        // `meta.peerId` for context. Caller is expected to populate
        // `targetUserId` via `meta.authorId` if known — admin can still
        // jump to the user from there.
        const fromMeta = (dto.meta?.['authorId'] ?? null) as
          | string
          | null;
        if (fromMeta && Types.ObjectId.isValid(fromMeta)) {
          targetUserId = new Types.ObjectId(fromMeta);
        }
        break;
      }
    }

    // Dedupe identical reports inside a 1-hour window — guards against
    // double-tap submissions and abusive flooding without rejecting
    // legitimate repeat reports days apart.
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const existing = await this.reportModel
      .findOne({
        reporterId: reporterOid,
        targetType: dto.targetType,
        targetId: dto.targetId,
        reason: dto.reason,
        createdAt: { $gte: oneHourAgo },
      })
      .exec();
    if (existing) return existing;

    const created = await this.reportModel.create({
      reporterId: reporterOid,
      targetType: dto.targetType,
      targetId: dto.targetId,
      targetUserId,
      reason: dto.reason,
      description: dto.description ?? '',
      meta: dto.meta ?? {},
      status: ReportStatus.PENDING,
    });

    this.logger.log(
      `Report ${created._id} (${dto.targetType}:${dto.targetId}, ${dto.reason}) ` +
        `filed by ${reporterId}`,
    );
    return created;
  }

  // ============== Admin ==============

  async list(params: ListReportsParams) {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(100, Math.max(1, params.limit ?? 20));
    const skip = (page - 1) * limit;

    const filter: FilterQuery<UserReportDocument> = {};
    if (params.status) filter.status = params.status;
    if (params.reason) filter.reason = params.reason;
    if (params.targetType) filter.targetType = params.targetType;
    if (params.targetUserId && Types.ObjectId.isValid(params.targetUserId)) {
      filter.targetUserId = new Types.ObjectId(params.targetUserId);
    }

    const [items, total] = await Promise.all([
      this.reportModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('reporterId', 'username displayName avatarUrl numericId')
        .populate('targetUserId', 'username displayName avatarUrl numericId')
        .exec(),
      this.reportModel.countDocuments(filter).exec(),
    ]);

    return { items, page, limit, total };
  }

  async getById(id: string): Promise<UserReportDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException({
        code: 'INVALID_ID',
        message: 'Invalid id',
      });
    }
    const report = await this.reportModel
      .findById(id)
      .populate('reporterId', 'username displayName avatarUrl numericId')
      .populate('targetUserId', 'username displayName avatarUrl numericId')
      .exec();
    if (!report) {
      throw new NotFoundException({
        code: 'REPORT_NOT_FOUND',
        message: 'Report not found',
      });
    }
    return report;
  }

  async update(
    id: string,
    adminId: string,
    dto: UpdateReportDto,
  ): Promise<UserReportDocument> {
    const report = await this.getById(id);
    report.status = dto.status;
    if (dto.adminNote !== undefined) report.adminNote = dto.adminNote;
    if (dto.status !== ReportStatus.PENDING) {
      report.resolvedAt = new Date();
      report.resolvedBy = Types.ObjectId.isValid(adminId)
        ? new Types.ObjectId(adminId)
        : null;
    }
    await report.save();
    return report;
  }

  /** Quick counts for the admin dashboard / sidebar badge. */
  async pendingCount(): Promise<number> {
    return this.reportModel
      .countDocuments({ status: ReportStatus.PENDING })
      .exec();
  }
}
