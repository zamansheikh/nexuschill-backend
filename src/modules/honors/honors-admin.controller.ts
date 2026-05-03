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
import {
  CreateHonorItemDto,
  GrantHonorDto,
  UpdateHonorItemDto,
} from './dto/honors.dto';
import { HonorCategory } from './schemas/honor-item.schema';
import { HonorsService } from './honors.service';

const MAX_ICON_BYTES = 5 * 1024 * 1024;
const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

/// Admin oversight + management for honors.
///
/// Two surfaces:
///   • catalog CRUD under `/admin/honors` — gated by `honors.manage`.
///   • per-user grant/revoke under `/admin/users/:id/honors` — gated
///     by `honors.grant` (a moderator can hand out medals without
///     having full catalog edit rights).
@Controller({ version: '1' })
@AdminOnly()
export class HonorsAdminController {
  constructor(private readonly honors: HonorsService) {}

  // -------- Catalog --------

  @RequirePermissions(PERMISSIONS.HONORS_VIEW)
  @Get('admin/honors')
  async listCatalog(
    @Query('category') category?: HonorCategory,
    @Query('search') search?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.honors.listCatalog({ category, search, page, limit });
  }

  @RequirePermissions(PERMISSIONS.HONORS_VIEW)
  @Get('admin/honors/:id')
  async getOne(@Param('id') id: string) {
    const item = await this.honors.getByIdOrThrow(id);
    return { item };
  }

  @RequirePermissions(PERMISSIONS.HONORS_MANAGE)
  @Post('admin/honors')
  async create(@Body() dto: CreateHonorItemDto) {
    const item = await this.honors.create(dto);
    return { item };
  }

  @RequirePermissions(PERMISSIONS.HONORS_MANAGE)
  @Patch('admin/honors/:id')
  async update(@Param('id') id: string, @Body() dto: UpdateHonorItemDto) {
    const item = await this.honors.update(id, dto);
    return { item };
  }

  // -------- Asset uploads --------

  /**
   * Upload a static-image icon. Returns `{ url, publicId, assetType }`
   * — admin form persists those onto the honor item via PATCH so the
   * upload + form-save are decoupled (idiomatic with the existing
   * cosmetics flow).
   */
  @RequirePermissions(PERMISSIONS.HONORS_MANAGE)
  @HttpCode(HttpStatus.OK)
  @Post('admin/honors/upload/icon')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_ICON_BYTES } }),
  )
  async uploadIconImage(@UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException({
        code: 'FILE_REQUIRED',
        message: 'File required',
      });
    }
    if (!IMAGE_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException({
        code: 'INVALID_FILE_TYPE',
        message: `Image must be one of ${IMAGE_MIME_TYPES.join(', ')}`,
        details: { received: file.mimetype },
      });
    }
    return this.honors.uploadIconImage(file.buffer);
  }

  /**
   * Upload an SVGA animated icon. Cloudinary stores it as raw asset.
   * The mobile renderer detects `iconAssetType: svga` and pipes the
   * URL through the SVGA player instead of CachedNetworkImage.
   */
  @RequirePermissions(PERMISSIONS.HONORS_MANAGE)
  @HttpCode(HttpStatus.OK)
  @Post('admin/honors/upload/svga')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_ICON_BYTES } }),
  )
  async uploadIconSvga(@UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException({
        code: 'FILE_REQUIRED',
        message: 'File required',
      });
    }
    const name = (file.originalname || '').toLowerCase();
    if (!name.endsWith('.svga')) {
      throw new BadRequestException({
        code: 'INVALID_FILE_TYPE',
        message: 'File must have .svga extension',
        details: { received: name },
      });
    }
    return this.honors.uploadIconSvga(file.buffer);
  }

  // -------- Per-user grant / revoke --------

  /** Read a user's earned honors — useful in admin Users views to
   *  inspect what's been granted previously before issuing more. */
  @RequirePermissions(PERMISSIONS.HONORS_VIEW)
  @Get('admin/users/:id/honors')
  async listForUser(@Param('id') userId: string) {
    return this.honors.listForUser(userId);
  }

  /** Grant an honor to a user. Idempotent on (user, honor) — re-grant
   *  bumps the tier rather than duplicating. */
  @RequirePermissions(PERMISSIONS.HONORS_GRANT)
  @Post('admin/users/:id/honors')
  async grant(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Param('id') userId: string,
    @Body() dto: GrantHonorDto,
  ) {
    const grant = await this.honors.grantToUser(userId, dto, {
      grantedByAdminId: admin.adminId,
    });
    return { grant };
  }

  @RequirePermissions(PERMISSIONS.HONORS_GRANT)
  @Delete('admin/users/:id/honors/:honorItemId')
  async revoke(
    @Param('id') userId: string,
    @Param('honorItemId') honorItemId: string,
  ) {
    return this.honors.revokeFromUser(userId, honorItemId);
  }
}
