import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import { AdminOnly } from '../admin/admin-auth/decorators/admin-only.decorator';
import { CurrentAdmin } from '../admin/admin-auth/decorators/current-admin.decorator';
import { RequirePermissions } from '../admin/admin-auth/decorators/require-permissions.decorator';
import { AuthenticatedAdmin } from '../admin/admin-auth/strategies/admin-jwt.strategy';
import { PERMISSIONS } from '../admin/permissions.catalog';
import { CreateGiftDto, UpdateGiftDto } from './dto/gift.dto';
import { GiftsService } from './gifts.service';
import { GiftAssetType, GiftCategory } from './schemas/gift.schema';

const MAX_THUMBNAIL_BYTES = 4 * 1024 * 1024; // 4 MB
const MAX_ANIMATION_BYTES = 16 * 1024 * 1024; // 16 MB — SVGAs are chunky
const THUMBNAIL_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

@Controller({ path: 'admin/gifts', version: '1' })
@AdminOnly()
export class AdminGiftsController {
  constructor(private readonly gifts: GiftsService) {}

  @RequirePermissions(PERMISSIONS.GIFTS_VIEW)
  @Get()
  async list(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('active') active?: string,
    @Query('category') category?: GiftCategory,
    @Query('featured') featured?: string,
    @Query('search') search?: string,
  ) {
    return this.gifts.list({
      page,
      limit,
      active: active === undefined ? undefined : active === 'true',
      category,
      featured: featured === undefined ? undefined : featured === 'true',
      search,
    });
  }

  @RequirePermissions(PERMISSIONS.GIFTS_VIEW)
  @Get('events')
  async listEvents(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('senderId') senderId?: string,
    @Query('receiverId') receiverId?: string,
    @Query('giftId') giftId?: string,
  ) {
    return this.gifts.listAllEvents({ page, limit, senderId, receiverId, giftId });
  }

  @RequirePermissions(PERMISSIONS.GIFTS_VIEW)
  @Get(':id')
  async getOne(@Param('id') id: string) {
    const gift = await this.gifts.getByIdOrThrow(id);
    return { gift };
  }

  @RequirePermissions(PERMISSIONS.GIFTS_MANAGE)
  @Post()
  async create(@Body() dto: CreateGiftDto, @CurrentAdmin() admin: AuthenticatedAdmin) {
    const gift = await this.gifts.create(dto, admin.adminId);
    return { gift };
  }

  @RequirePermissions(PERMISSIONS.GIFTS_MANAGE)
  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateGiftDto) {
    const gift = await this.gifts.update(id, dto);
    return { gift };
  }

  @RequirePermissions(PERMISSIONS.GIFTS_MANAGE)
  @Delete(':id')
  async softDelete(@Param('id') id: string) {
    await this.gifts.softDelete(id);
    return { success: true };
  }

  /// Permanently delete a gift. Server enforces `totalSent === 0` —
  /// returns 409 if anyone has ever sent the gift, in which case the
  /// admin should deactivate (`DELETE /:id`) instead.
  @RequirePermissions(PERMISSIONS.GIFTS_MANAGE)
  @Delete(':id/purge')
  async purge(@Param('id') id: string) {
    await this.gifts.purge(id);
    return { success: true };
  }

  // ---------- Asset uploads ----------

  /// Static thumbnail (PNG/JPG/WebP/GIF). Mirrors the cosmetics upload
  /// path so the admin form can use the same drag-and-drop UX.
  @RequirePermissions(PERMISSIONS.GIFTS_MANAGE)
  @HttpCode(HttpStatus.OK)
  @Post('upload/thumbnail')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_THUMBNAIL_BYTES } }))
  async uploadThumbnail(@UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException({ code: 'FILE_REQUIRED', message: 'File required' });
    }
    if (!THUMBNAIL_TYPES.includes(file.mimetype)) {
      throw new BadRequestException({
        code: 'INVALID_FILE_TYPE',
        message: `Thumbnail must be one of ${THUMBNAIL_TYPES.join(', ')}`,
        details: { received: file.mimetype },
      });
    }
    const { url, publicId } = await this.gifts.uploadThumbnail(file.buffer);
    return { url, publicId };
  }

  /// Animated asset (SVGA / Lottie JSON / MP4). Server picks Cloudinary's
  /// resource_type from the file extension and returns the matching
  /// GiftAssetType so the form auto-fills it.
  @RequirePermissions(PERMISSIONS.GIFTS_MANAGE)
  @HttpCode(HttpStatus.OK)
  @Post('upload/animation')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_ANIMATION_BYTES } }))
  async uploadAnimation(@UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException({ code: 'FILE_REQUIRED', message: 'File required' });
    }
    const name = (file.originalname || '').toLowerCase();
    let resourceType: 'raw' | 'video';
    let assetType: GiftAssetType;
    if (name.endsWith('.svga')) {
      resourceType = 'raw';
      assetType = GiftAssetType.SVGA;
    } else if (name.endsWith('.json')) {
      resourceType = 'raw';
      assetType = GiftAssetType.LOTTIE;
    } else if (name.endsWith('.mp4') || name.endsWith('.webm')) {
      resourceType = 'video';
      assetType = GiftAssetType.MP4;
    } else {
      throw new BadRequestException({
        code: 'UNSUPPORTED_ASSET',
        message: 'Animation must be .svga, .json (Lottie), .mp4, or .webm',
        details: { received: name },
      });
    }
    const { url, publicId } = await this.gifts.uploadAnimation(file.buffer, resourceType);
    return { url, publicId, assetType };
  }
}
