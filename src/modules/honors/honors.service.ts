import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';

import {
  CreateHonorItemDto,
  GrantHonorDto,
  UpdateHonorItemDto,
} from './dto/honors.dto';
import { MediaService } from '../media/media.service';
import {
  HonorAssetType,
  HonorCategory,
  HonorItem,
  HonorItemDocument,
} from './schemas/honor-item.schema';
import {
  HonorSource,
  UserHonor,
  UserHonorDocument,
} from './schemas/user-honor.schema';

interface ListCatalogParams {
  category?: HonorCategory;
  search?: string;
  active?: boolean;
  page?: number;
  limit?: number;
}

/**
 * Honor / achievement system.
 *
 * The catalog is admin-managed; user inventory grows via either:
 *   • direct admin grant (this service's `grantToUser`),
 *   • the task system calling `awardByKey(userId, key, tier?)` from
 *     other modules (room thresholds, recharge milestones, etc.) —
 *     same code path as admin grants but with `source: TASK`.
 *
 * Tiers live on the user's row, not the catalog row, so re-granting
 * the same item to a user just bumps their tier and `awardedAt` via
 * the unique (userId, honorItemId) index — no duplicate inventory.
 */
@Injectable()
export class HonorsService {
  constructor(
    @InjectModel(HonorItem.name)
    private readonly itemModel: Model<HonorItemDocument>,
    @InjectModel(UserHonor.name)
    private readonly userHonorModel: Model<UserHonorDocument>,
    private readonly media: MediaService,
  ) {}

  // ============== Asset uploads ==============

  /// Upload a static image icon. Returns Cloudinary URL + publicId.
  /// Mirrors `cosmetics.service.ts` so admins use the same picker UX.
  async uploadIconImage(
    buffer: Buffer,
  ): Promise<{ url: string; publicId: string; assetType: HonorAssetType }> {
    const res = await this.media.uploadImage(buffer, {
      folder: 'honors/icons',
    });
    return {
      url: res.secure_url,
      publicId: res.public_id,
      assetType: HonorAssetType.IMAGE,
    };
  }

  /// Upload an SVGA animated icon. Cloudinary stores SVGA as
  /// `resource_type: raw` (binary blob with no transcoding).
  async uploadIconSvga(
    buffer: Buffer,
  ): Promise<{ url: string; publicId: string; assetType: HonorAssetType }> {
    const res = await this.media.uploadAsset(buffer, {
      folder: 'honors/svga',
      resourceType: 'raw',
    });
    return {
      url: res.secure_url,
      publicId: res.public_id,
      assetType: HonorAssetType.SVGA,
    };
  }

  // ============== Catalog ==============

  async listCatalog(params: ListCatalogParams = {}) {
    const filter: FilterQuery<HonorItemDocument> = {};
    if (params.category) filter.category = params.category;
    if (params.active !== undefined) filter.active = params.active;
    if (params.search && params.search.trim().length > 0) {
      const q = params.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { name: { $regex: q, $options: 'i' } },
        { key: { $regex: q, $options: 'i' } },
      ];
    }
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(200, Math.max(1, params.limit ?? 50));
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      this.itemModel
        .find(filter)
        .sort({ sortOrder: 1, name: 1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.itemModel.countDocuments(filter).exec(),
    ]);
    return { items: items.map((i) => i.toJSON()), page, limit, total };
  }

  async getById(id: string): Promise<HonorItemDocument | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.itemModel.findById(id).exec();
  }

  async getByIdOrThrow(id: string): Promise<HonorItemDocument> {
    const item = await this.getById(id);
    if (!item) {
      throw new NotFoundException({
        code: 'HONOR_NOT_FOUND',
        message: 'Honor item not found',
      });
    }
    return item;
  }

  async getByKey(key: string): Promise<HonorItemDocument | null> {
    return this.itemModel.findOne({ key }).exec();
  }

  async create(input: CreateHonorItemDto): Promise<HonorItemDocument> {
    const exists = await this.itemModel.exists({ key: input.key });
    if (exists) {
      throw new ConflictException({
        code: 'HONOR_KEY_TAKEN',
        message: `Honor key "${input.key}" already in use`,
      });
    }
    return this.itemModel.create({
      key: input.key,
      name: input.name,
      description: input.description ?? '',
      category: input.category ?? HonorCategory.MEDAL,
      iconUrl: input.iconUrl ?? '',
      iconPublicId: input.iconPublicId ?? '',
      iconAssetType: input.iconAssetType ?? HonorAssetType.IMAGE,
      maxTier: input.maxTier ?? 5,
      sortOrder: input.sortOrder ?? 0,
      active: input.active ?? true,
    });
  }

  async update(
    id: string,
    update: UpdateHonorItemDto,
  ): Promise<HonorItemDocument> {
    const item = await this.getByIdOrThrow(id);
    if (update.name !== undefined) item.name = update.name;
    if (update.description !== undefined) item.description = update.description;
    if (update.category !== undefined) item.category = update.category;
    if (update.iconUrl !== undefined) item.iconUrl = update.iconUrl;
    if (update.iconPublicId !== undefined) {
      item.iconPublicId = update.iconPublicId;
    }
    if (update.iconAssetType !== undefined) {
      item.iconAssetType = update.iconAssetType;
    }
    if (update.maxTier !== undefined) item.maxTier = update.maxTier;
    if (update.sortOrder !== undefined) item.sortOrder = update.sortOrder;
    if (update.active !== undefined) item.active = update.active;
    await item.save();
    return item;
  }

  // ============== Per-user inventory ==============

  /** Public-facing list: every honor a given user has earned, hydrated
   *  with the catalog row so the mobile UI can render the icon + name
   *  + star count in one fetch. */
  async listForUser(userId: string) {
    if (!Types.ObjectId.isValid(userId)) return { items: [] };
    const rows = await this.userHonorModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ awardedAt: -1 })
      .populate('honorItemId')
      .lean()
      .exec();
    const items = rows
      .map((r) => {
        const item = r.honorItemId as unknown as HonorItem & {
          _id: Types.ObjectId;
          active: boolean;
        };
        if (!item || item.active === false) return null;
        return {
          id: r._id.toString(),
          honorItemId: item._id.toString(),
          key: item.key,
          name: item.name,
          description: (item as any).description ?? '',
          category: item.category,
          iconUrl: item.iconUrl ?? '',
          iconAssetType: item.iconAssetType ?? HonorAssetType.IMAGE,
          maxTier: item.maxTier,
          tier: r.tier,
          source: r.source,
          note: r.note ?? '',
          awardedAt: r.awardedAt,
          sortOrder: (item as any).sortOrder ?? 0,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    return { items };
  }

  /**
   * Grant an honor to a user. The honor is identified by either its
   * catalog `_id` or its stable `key` — admins paste from either the
   * catalog table or from internal docs without coercing ids.
   *
   * Idempotent on (userId, honorItemId): re-granting upgrades the
   * tier + bumps `awardedAt` rather than inserting a duplicate.
   * `tier` defaults to the catalog's `maxTier` (an admin saying
   * "give them this medal" usually means the full version). For
   * gradual progression the task-system path passes `tier: 1`.
   */
  async grantToUser(
    userId: string,
    dto: GrantHonorDto,
    opts: {
      source?: HonorSource;
      grantedByAdminId?: string | null;
    } = {},
  ): Promise<UserHonorDocument> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException({
        code: 'INVALID_USER_ID',
        message: 'Invalid user id',
      });
    }
    const item = await this.resolveItem(dto.honorRef);
    if (!item.active) {
      throw new BadRequestException({
        code: 'HONOR_INACTIVE',
        message: 'Honor item is not active',
      });
    }
    const tier = Math.min(Math.max(dto.tier ?? item.maxTier, 1), item.maxTier);
    const userOid = new Types.ObjectId(userId);
    const adminOid =
      opts.grantedByAdminId && Types.ObjectId.isValid(opts.grantedByAdminId)
        ? new Types.ObjectId(opts.grantedByAdminId)
        : null;
    return this.userHonorModel
      .findOneAndUpdate(
        { userId: userOid, honorItemId: item._id },
        {
          $set: {
            tier,
            source: opts.source ?? HonorSource.ADMIN_GRANT,
            awardedBy: adminOid,
            note: dto.note ?? '',
            awardedAt: new Date(),
          },
          $setOnInsert: {
            userId: userOid,
            honorItemId: item._id,
          },
        },
        { upsert: true, new: true },
      )
      .exec() as Promise<UserHonorDocument>;
  }

  /** Convenience for the task system / event hooks. Same flow as
   *  `grantToUser` but keyed off the stable `key` and tagged with
   *  `source: TASK` so audit trails distinguish auto-awards from
   *  admin actions. */
  async awardByKey(
    userId: string,
    key: string,
    tier: number,
  ): Promise<UserHonorDocument | null> {
    const item = await this.getByKey(key);
    if (!item || !item.active) return null;
    return this.grantToUser(
      userId,
      { honorRef: key, tier },
      { source: HonorSource.TASK },
    );
  }

  async revokeFromUser(
    userId: string,
    honorItemId: string,
  ): Promise<{ removed: boolean }> {
    if (
      !Types.ObjectId.isValid(userId) ||
      !Types.ObjectId.isValid(honorItemId)
    ) {
      return { removed: false };
    }
    const res = await this.userHonorModel
      .deleteOne({
        userId: new Types.ObjectId(userId),
        honorItemId: new Types.ObjectId(honorItemId),
      })
      .exec();
    return { removed: res.deletedCount > 0 };
  }

  // ============== Helpers ==============

  /** Accept either an _id or the stable `key` — admins copy from
   *  whichever surface is in front of them. */
  private async resolveItem(ref: string): Promise<HonorItemDocument> {
    const byId = Types.ObjectId.isValid(ref) ? await this.getById(ref) : null;
    if (byId) return byId;
    const byKey = await this.getByKey(ref);
    if (byKey) return byKey;
    throw new NotFoundException({
      code: 'HONOR_NOT_FOUND',
      message: `Honor "${ref}" not found`,
    });
  }
}
