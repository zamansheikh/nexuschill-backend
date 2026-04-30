import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';

import { MediaService } from '../media/media.service';
import {
  MomentLike,
  MomentLikeDocument,
} from './schemas/moment-like.schema';
import {
  Moment,
  MomentDocument,
  MomentStatus,
} from './schemas/moment.schema';

interface ListFeedParams {
  page?: number;
  limit?: number;
  authorId?: string;
}

@Injectable()
export class MomentsService {
  private readonly logger = new Logger(MomentsService.name);

  constructor(
    @InjectModel(Moment.name) private readonly momentModel: Model<MomentDocument>,
    @InjectModel(MomentLike.name)
    private readonly likeModel: Model<MomentLikeDocument>,
    private readonly media: MediaService,
  ) {}

  // ============== Author-side ==============

  async create(authorId: string, input: any): Promise<MomentDocument> {
    if (!Types.ObjectId.isValid(authorId)) {
      throw new BadRequestException({ code: 'INVALID_USER_ID', message: 'Invalid user' });
    }
    const text = (input.text ?? '').trim();
    const media = (input.media ?? []) as Array<Record<string, unknown>>;
    if (text.length === 0 && media.length === 0) {
      throw new BadRequestException({
        code: 'EMPTY_MOMENT',
        message: 'Moment must have text or at least one image',
      });
    }
    return this.momentModel.create({
      authorId: new Types.ObjectId(authorId),
      text,
      media,
      status: MomentStatus.ACTIVE,
    });
  }

  /** Author or admin can delete; users can only delete their own. */
  async deleteOwn(momentId: string, userId: string): Promise<void> {
    const m = await this.getByIdOrThrow(momentId);
    if (m.authorId.toString() !== userId) {
      throw new ForbiddenException({
        code: 'NOT_AUTHOR',
        message: 'You can only delete your own moments',
      });
    }
    m.status = MomentStatus.DELETED;
    await m.save();
    // Best-effort cleanup of Cloudinary assets — don't block the response.
    for (const piece of m.media) {
      if (piece.publicId) {
        this.media.deleteImage(piece.publicId).catch(() => undefined);
      }
    }
  }

  // ============== Feed (user-facing) ==============

  /**
   * Public feed. For now: most-recent active posts, optionally filtered
   * to a single author. Follower-only / interest-graph ranking lands when
   * the social graph is built.
   */
  async listFeed(viewerId: string | null, params: ListFeedParams) {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(50, Math.max(1, params.limit ?? 20));
    const skip = (page - 1) * limit;

    const filter: FilterQuery<MomentDocument> = { status: MomentStatus.ACTIVE };
    if (params.authorId && Types.ObjectId.isValid(params.authorId)) {
      filter.authorId = new Types.ObjectId(params.authorId);
    }

    const [items, total] = await Promise.all([
      this.momentModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('authorId', 'username displayName avatarUrl numericId level isHost')
        .exec(),
      this.momentModel.countDocuments(filter).exec(),
    ]);

    // Annotate each row with `likedByMe` so the mobile heart icon paints
    // the right state on first render. Single round-trip across the page.
    let likedSet = new Set<string>();
    if (viewerId && Types.ObjectId.isValid(viewerId) && items.length > 0) {
      const likes = await this.likeModel
        .find({
          userId: new Types.ObjectId(viewerId),
          momentId: { $in: items.map((m) => m._id) },
        })
        .select('momentId')
        .exec();
      likedSet = new Set(likes.map((l) => l.momentId.toString()));
    }
    const annotated = items.map((m) => {
      const json = m.toJSON() as Record<string, unknown>;
      json.likedByMe = likedSet.has(m._id.toString());
      return json;
    });

    return { items: annotated, page, limit, total };
  }

  // ============== Likes ==============

  async like(momentId: string, userId: string): Promise<{ likeCount: number }> {
    if (!Types.ObjectId.isValid(momentId) || !Types.ObjectId.isValid(userId)) {
      throw new BadRequestException({ code: 'INVALID_ID', message: 'Invalid id' });
    }
    const moment = await this.getByIdOrThrow(momentId);
    if (moment.status !== MomentStatus.ACTIVE) {
      throw new BadRequestException({
        code: 'MOMENT_INACTIVE',
        message: 'Cannot like an inactive moment',
      });
    }

    // Insert idempotently. Duplicate-key (E11000) means already liked → no-op.
    let inserted = false;
    try {
      await this.likeModel.create({
        momentId: new Types.ObjectId(momentId),
        userId: new Types.ObjectId(userId),
      });
      inserted = true;
    } catch (err: any) {
      if (err?.code !== 11000) throw err;
    }

    if (inserted) {
      await this.momentModel
        .updateOne({ _id: moment._id }, { $inc: { likeCount: 1 } })
        .exec();
    }
    const fresh = await this.momentModel.findById(moment._id).select('likeCount').exec();
    return { likeCount: fresh?.likeCount ?? moment.likeCount };
  }

  async unlike(momentId: string, userId: string): Promise<{ likeCount: number }> {
    if (!Types.ObjectId.isValid(momentId) || !Types.ObjectId.isValid(userId)) {
      throw new BadRequestException({ code: 'INVALID_ID', message: 'Invalid id' });
    }
    const moment = await this.getByIdOrThrow(momentId);
    const res = await this.likeModel
      .deleteOne({
        momentId: new Types.ObjectId(momentId),
        userId: new Types.ObjectId(userId),
      })
      .exec();
    if (res.deletedCount === 1) {
      await this.momentModel
        .updateOne(
          { _id: moment._id, likeCount: { $gt: 0 } },
          { $inc: { likeCount: -1 } },
        )
        .exec();
    }
    const fresh = await this.momentModel.findById(moment._id).select('likeCount').exec();
    return { likeCount: fresh?.likeCount ?? moment.likeCount };
  }

  // ============== Admin moderation ==============

  async listAdmin(params: { page?: number; limit?: number; status?: MomentStatus }) {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(100, Math.max(1, params.limit ?? 30));
    const skip = (page - 1) * limit;
    const filter: FilterQuery<MomentDocument> = {};
    if (params.status) filter.status = params.status;
    const [items, total] = await Promise.all([
      this.momentModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('authorId', 'username displayName numericId')
        .exec(),
      this.momentModel.countDocuments(filter).exec(),
    ]);
    return { items, page, limit, total };
  }

  async adminRemove(momentId: string, reason: string, adminId?: string): Promise<MomentDocument> {
    const m = await this.getByIdOrThrow(momentId);
    m.status = MomentStatus.REMOVED;
    m.removedReason = reason;
    m.removedAt = new Date();
    if (adminId && Types.ObjectId.isValid(adminId)) {
      m.removedBy = new Types.ObjectId(adminId);
    }
    await m.save();
    return m;
  }

  async adminRestore(momentId: string): Promise<MomentDocument> {
    const m = await this.getByIdOrThrow(momentId);
    m.status = MomentStatus.ACTIVE;
    m.removedReason = '';
    m.removedAt = null;
    m.removedBy = null;
    await m.save();
    return m;
  }

  // ============== helpers ==============

  async getByIdOrThrow(id: string): Promise<MomentDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Moment not found');
    }
    const m = await this.momentModel.findById(id).exec();
    if (!m) throw new NotFoundException('Moment not found');
    return m;
  }
}
