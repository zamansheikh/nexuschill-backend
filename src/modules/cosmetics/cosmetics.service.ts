import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';

import { MediaService } from '../media/media.service';
import {
  CosmeticAssetType,
  CosmeticItem,
  CosmeticItemDocument,
  CosmeticType,
} from './schemas/cosmetic-item.schema';
import {
  CosmeticSource,
  UserCosmetic,
  UserCosmeticDocument,
} from './schemas/user-cosmetic.schema';

interface ListItemsParams {
  page?: number;
  limit?: number;
  type?: CosmeticType;
  active?: boolean;
  search?: string;
}

@Injectable()
export class CosmeticsService {
  constructor(
    @InjectModel(CosmeticItem.name)
    private readonly itemModel: Model<CosmeticItemDocument>,
    @InjectModel(UserCosmetic.name)
    private readonly userCosmeticModel: Model<UserCosmeticDocument>,
    private readonly media: MediaService,
  ) {}

  // ============== Catalog (admin-side CRUD) ==============

  async list(params: ListItemsParams) {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(100, Math.max(1, params.limit ?? 50));
    const skip = (page - 1) * limit;

    const filter: FilterQuery<CosmeticItemDocument> = {};
    if (params.type) filter.type = params.type;
    if (params.active !== undefined) filter.active = params.active;
    if (params.search) {
      const escaped = params.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'i');
      filter.$or = [
        { code: regex },
        { 'name.en': regex },
        { 'name.bn': regex },
      ];
    }

    const [items, total] = await Promise.all([
      this.itemModel
        .find(filter)
        .sort({ type: 1, sortOrder: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.itemModel.countDocuments(filter).exec(),
    ]);
    return { items, page, limit, total };
  }

  async findById(id: string): Promise<CosmeticItemDocument | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.itemModel.findById(id).exec();
  }

  async getByIdOrThrow(id: string): Promise<CosmeticItemDocument> {
    const it = await this.findById(id);
    if (!it) throw new NotFoundException('Cosmetic item not found');
    return it;
  }

  async create(input: any, createdBy?: string): Promise<CosmeticItemDocument> {
    const codeUpper = input.code.toUpperCase();
    const exists = await this.itemModel.countDocuments({ code: codeUpper }).exec();
    if (exists) {
      throw new ConflictException({
        code: 'COSMETIC_CODE_TAKEN',
        message: `Cosmetic code "${codeUpper}" already in use`,
      });
    }
    return this.itemModel.create({
      ...input,
      code: codeUpper,
      createdBy:
        createdBy && Types.ObjectId.isValid(createdBy)
          ? new Types.ObjectId(createdBy)
          : null,
    });
  }

  async update(id: string, update: any): Promise<CosmeticItemDocument> {
    const it = await this.getByIdOrThrow(id);

    if (update.code !== undefined) {
      const codeUpper = update.code.toUpperCase();
      if (codeUpper !== it.code) {
        const exists = await this.itemModel.countDocuments({ code: codeUpper }).exec();
        if (exists) {
          throw new ConflictException({ code: 'COSMETIC_CODE_TAKEN', message: 'Code in use' });
        }
        it.code = codeUpper;
      }
    }
    if (update.name !== undefined) it.name = update.name;
    if (update.description !== undefined) it.description = update.description;
    if (update.type !== undefined) it.type = update.type;
    if (update.previewUrl !== undefined) it.previewUrl = update.previewUrl;
    if (update.previewPublicId !== undefined) it.previewPublicId = update.previewPublicId;
    if (update.assetUrl !== undefined) it.assetUrl = update.assetUrl;
    if (update.assetPublicId !== undefined) it.assetPublicId = update.assetPublicId;
    if (update.assetType !== undefined) it.assetType = update.assetType;
    if (update.rarity !== undefined) it.rarity = update.rarity;
    if (update.active !== undefined) it.active = update.active;
    if (update.sortOrder !== undefined) it.sortOrder = update.sortOrder;

    await it.save();
    return it;
  }

  async softDelete(id: string): Promise<void> {
    const it = await this.getByIdOrThrow(id);
    it.active = false;
    await it.save();
  }

  // ============== Media upload helpers ==============

  /**
   * Upload preview (image) for a cosmetic. Returns { url, publicId } so the
   * controller can persist them on the item record.
   */
  async uploadPreview(buffer: Buffer): Promise<{ url: string; publicId: string }> {
    const res = await this.media.uploadImage(buffer, { folder: 'cosmetics/previews' });
    return { url: res.secure_url, publicId: res.public_id };
  }

  /**
   * Upload animated asset (SVGA/Lottie) as a "raw" Cloudinary resource.
   * MP4 would use `video` instead — caller passes the resourceType via
   * inferring from the file extension/mimetype.
   */
  async uploadAsset(
    buffer: Buffer,
    resourceType: 'raw' | 'video',
  ): Promise<{ url: string; publicId: string }> {
    const res = await this.media.uploadAsset(buffer, {
      folder: 'cosmetics/assets',
      resourceType,
    });
    return { url: res.secure_url, publicId: res.public_id };
  }

  // ============== User inventory (used by SVIP / Store / Gift) ==============

  /**
   * Idempotent grant. If a user already owns this item from this source +
   * externalRef, return the existing record (and extend expiry if longer).
   */
  async grantToUser(params: {
    userId: string;
    cosmeticItemId: string;
    source: CosmeticSource;
    durationDays?: number | null;
    giftedBy?: string;
    svipTier?: number;
    externalRef?: string;
  }): Promise<UserCosmeticDocument> {
    const userObj = new Types.ObjectId(params.userId);
    const itemObj = new Types.ObjectId(params.cosmeticItemId);
    const externalRef = params.externalRef ?? '';

    const expiresAt =
      params.durationDays && params.durationDays > 0
        ? new Date(Date.now() + params.durationDays * 86_400_000)
        : null;

    const existing = await this.userCosmeticModel
      .findOne({
        userId: userObj,
        cosmeticItemId: itemObj,
        source: params.source,
        externalRef,
      })
      .exec();

    if (existing) {
      // Extend expiry if the new grant is longer.
      if (expiresAt && (!existing.expiresAt || existing.expiresAt < expiresAt)) {
        existing.expiresAt = expiresAt;
        await existing.save();
      } else if (expiresAt === null && existing.expiresAt) {
        existing.expiresAt = null;
        await existing.save();
      }
      return existing;
    }

    return this.userCosmeticModel.create({
      userId: userObj,
      cosmeticItemId: itemObj,
      source: params.source,
      externalRef,
      acquiredAt: new Date(),
      expiresAt,
      giftedBy:
        params.giftedBy && Types.ObjectId.isValid(params.giftedBy)
          ? new Types.ObjectId(params.giftedBy)
          : null,
      svipTier: params.svipTier ?? null,
    });
  }

  /** All cosmetics owned by a user, including expired (caller can filter). */
  async listUserCosmetics(userId: string) {
    if (!Types.ObjectId.isValid(userId)) return [];
    return this.userCosmeticModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ acquiredAt: -1 })
      .populate('cosmeticItemId')
      .exec();
  }

  /**
   * Equipped cosmetics for a batch of users — used by the audio-room view
   * to hydrate avatar frames, mic skins, and chat bubbles in one round
   * trip. Returns rows keyed by userId so the client can group them
   * locally.
   *
   * Skips expired rows. Only `equipped: true` is returned.
   */
  async listEquippedForUsers(userIds: string[]): Promise<UserCosmeticDocument[]> {
    const oids = userIds
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));
    if (oids.length === 0) return [];
    const now = new Date();
    return this.userCosmeticModel
      .find({
        userId: { $in: oids },
        equipped: true,
        $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
      })
      .populate('cosmeticItemId')
      .exec();
  }

  /**
   * Mark one item as equipped for a user, unequipping any other of the same
   * `type` so the user has at most one active item per slot.
   */
  async equip(userId: string, userCosmeticId: string): Promise<UserCosmeticDocument> {
    const owned = await this.userCosmeticModel.findById(userCosmeticId).exec();
    if (!owned || owned.userId.toString() !== userId) {
      throw new NotFoundException('Cosmetic not owned');
    }
    if (owned.expiresAt && owned.expiresAt < new Date()) {
      throw new ConflictException({
        code: 'COSMETIC_EXPIRED',
        message: 'This cosmetic has expired',
      });
    }
    const item = await this.itemModel.findById(owned.cosmeticItemId).exec();
    if (!item) throw new NotFoundException('Cosmetic item missing');

    // Unequip any other of the same type for this user.
    const peerItemIds = await this.itemModel.find({ type: item.type }, { _id: 1 }).exec();
    await this.userCosmeticModel
      .updateMany(
        {
          userId: new Types.ObjectId(userId),
          cosmeticItemId: { $in: peerItemIds.map((p) => p._id) },
          equipped: true,
        },
        { $set: { equipped: false } },
      )
      .exec();

    owned.equipped = true;
    await owned.save();
    return owned;
  }
}
