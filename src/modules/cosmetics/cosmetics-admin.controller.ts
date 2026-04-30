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
import { CosmeticsService } from './cosmetics.service';
import {
  CreateCosmeticItemDto,
  UpdateCosmeticItemDto,
} from './dto/cosmetic-item.dto';
import { CosmeticAssetType, CosmeticType } from './schemas/cosmetic-item.schema';

const MAX_PREVIEW_BYTES = 4 * 1024 * 1024; // 4 MB
const MAX_ASSET_BYTES = 16 * 1024 * 1024; // 16 MB — SVGAs can be chunky
const PREVIEW_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

@Controller({ path: 'admin/cosmetics', version: '1' })
@AdminOnly()
export class CosmeticsAdminController {
  constructor(private readonly cosmetics: CosmeticsService) {}

  @RequirePermissions(PERMISSIONS.COSMETICS_VIEW)
  @Get()
  async list(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('type') type?: CosmeticType,
    @Query('active') active?: string,
    @Query('search') search?: string,
  ) {
    const activeBool = active === undefined ? undefined : active === 'true';
    return this.cosmetics.list({ page, limit, type, active: activeBool, search });
  }

  @RequirePermissions(PERMISSIONS.COSMETICS_VIEW)
  @Get(':id')
  async getOne(@Param('id') id: string) {
    const item = await this.cosmetics.getByIdOrThrow(id);
    return { item };
  }

  @RequirePermissions(PERMISSIONS.COSMETICS_MANAGE)
  @Post()
  async create(
    @Body() dto: CreateCosmeticItemDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    const item = await this.cosmetics.create(dto, admin.adminId);
    return { item };
  }

  @RequirePermissions(PERMISSIONS.COSMETICS_MANAGE)
  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateCosmeticItemDto) {
    const item = await this.cosmetics.update(id, dto);
    return { item };
  }

  @RequirePermissions(PERMISSIONS.COSMETICS_MANAGE)
  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.cosmetics.softDelete(id);
    return { ok: true };
  }

  // ---------- Asset uploads ----------

  /** Static preview (PNG/JPG/WebP). Returns { url, publicId } — caller stores them. */
  @RequirePermissions(PERMISSIONS.COSMETICS_MANAGE)
  @HttpCode(HttpStatus.OK)
  @Post('upload/preview')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_PREVIEW_BYTES } }))
  async uploadPreview(@UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException({ code: 'FILE_REQUIRED', message: 'File required' });
    if (!PREVIEW_TYPES.includes(file.mimetype)) {
      throw new BadRequestException({
        code: 'INVALID_FILE_TYPE',
        message: `Preview must be one of ${PREVIEW_TYPES.join(', ')}`,
        details: { received: file.mimetype },
      });
    }
    const { url, publicId } = await this.cosmetics.uploadPreview(file.buffer);
    return { url, publicId };
  }

  /**
   * Animated asset (SVGA / Lottie JSON / MP4).
   * Server inspects the extension to decide Cloudinary's resource_type:
   *   .svga / .json    → raw
   *   .mp4 / .webm     → video
   * Returns { url, publicId, assetType }.
   */
  @RequirePermissions(PERMISSIONS.COSMETICS_MANAGE)
  @HttpCode(HttpStatus.OK)
  @Post('upload/asset')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_ASSET_BYTES } }))
  async uploadAsset(@UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException({ code: 'FILE_REQUIRED', message: 'File required' });

    const name = (file.originalname || '').toLowerCase();
    let resourceType: 'raw' | 'video';
    let assetType: CosmeticAssetType;
    if (name.endsWith('.svga')) {
      resourceType = 'raw';
      assetType = CosmeticAssetType.SVGA;
    } else if (name.endsWith('.json')) {
      resourceType = 'raw';
      assetType = CosmeticAssetType.LOTTIE;
    } else if (name.endsWith('.mp4') || name.endsWith('.webm')) {
      resourceType = 'video';
      assetType = CosmeticAssetType.MP4;
    } else {
      throw new BadRequestException({
        code: 'UNSUPPORTED_ASSET',
        message: 'Asset must be .svga, .json (Lottie), .mp4, or .webm',
        details: { received: name },
      });
    }

    const { url, publicId } = await this.cosmetics.uploadAsset(file.buffer, resourceType);
    return { url, publicId, assetType };
  }
}
