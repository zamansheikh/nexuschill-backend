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
import { BannersService } from './banners.service';
import {
  CreateHomeBannerDto,
  CreateRoomBannerDto,
  CreateSplashBannerDto,
  UpdateHomeBannerDto,
  UpdateRoomBannerDto,
  UpdateSplashBannerDto,
} from './dto/banner.dto';

const MAX_BANNER_BYTES = 6 * 1024 * 1024;
const ALLOWED = ['image/png', 'image/jpeg', 'image/webp'];

@Controller({ path: 'admin/banners', version: '1' })
@AdminOnly()
export class BannersAdminController {
  constructor(private readonly banners: BannersService) {}

  // ---------- Image upload (shared) ----------

  @RequirePermissions(PERMISSIONS.BANNERS_MANAGE)
  @HttpCode(HttpStatus.OK)
  @Post('upload/image')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BANNER_BYTES } }))
  async uploadImage(@UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException({ code: 'FILE_REQUIRED', message: 'File required' });
    if (!ALLOWED.includes(file.mimetype)) {
      throw new BadRequestException({
        code: 'INVALID_FILE_TYPE',
        message: `Banner must be one of ${ALLOWED.join(', ')}`,
        details: { received: file.mimetype },
      });
    }
    const { url, publicId } = await this.banners.uploadImage(file.buffer);
    return { url, publicId };
  }

  // ---------- Home banners (carousel) ----------

  @RequirePermissions(PERMISSIONS.BANNERS_VIEW)
  @Get('home')
  async listHome(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('active') active?: string,
  ) {
    const activeBool = active === undefined ? undefined : active === 'true';
    return this.banners.listAdminHome({ page, limit, active: activeBool });
  }

  @RequirePermissions(PERMISSIONS.BANNERS_VIEW)
  @Get('home/:id')
  async getHome(@Param('id') id: string) {
    const banner = await this.banners.getHomeOrThrow(id);
    return { banner };
  }

  @RequirePermissions(PERMISSIONS.BANNERS_MANAGE)
  @Post('home')
  async createHome(
    @Body() dto: CreateHomeBannerDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    const banner = await this.banners.createHome(dto, admin.adminId);
    return { banner };
  }

  @RequirePermissions(PERMISSIONS.BANNERS_MANAGE)
  @Patch('home/:id')
  async updateHome(@Param('id') id: string, @Body() dto: UpdateHomeBannerDto) {
    const banner = await this.banners.updateHome(id, dto);
    return { banner };
  }

  @RequirePermissions(PERMISSIONS.BANNERS_MANAGE)
  @Delete('home/:id')
  async deleteHome(@Param('id') id: string) {
    await this.banners.deleteHome(id);
    return { ok: true };
  }

  // ---------- Splash banners ----------

  @RequirePermissions(PERMISSIONS.BANNERS_VIEW)
  @Get('splash')
  async listSplash(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('active') active?: string,
  ) {
    const activeBool = active === undefined ? undefined : active === 'true';
    return this.banners.listAdminSplash({ page, limit, active: activeBool });
  }

  @RequirePermissions(PERMISSIONS.BANNERS_VIEW)
  @Get('splash/:id')
  async getSplash(@Param('id') id: string) {
    const banner = await this.banners.getSplashOrThrow(id);
    return { banner };
  }

  @RequirePermissions(PERMISSIONS.BANNERS_MANAGE)
  @Post('splash')
  async createSplash(
    @Body() dto: CreateSplashBannerDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    const banner = await this.banners.createSplash(dto, admin.adminId);
    return { banner };
  }

  @RequirePermissions(PERMISSIONS.BANNERS_MANAGE)
  @Patch('splash/:id')
  async updateSplash(@Param('id') id: string, @Body() dto: UpdateSplashBannerDto) {
    const banner = await this.banners.updateSplash(id, dto);
    return { banner };
  }

  @RequirePermissions(PERMISSIONS.BANNERS_MANAGE)
  @Delete('splash/:id')
  async deleteSplash(@Param('id') id: string) {
    await this.banners.deleteSplash(id);
    return { ok: true };
  }

  // ---------- Room banners (in-room sidebar carousel) ----------

  @RequirePermissions(PERMISSIONS.BANNERS_VIEW)
  @Get('room')
  async listRoom(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('active') active?: string,
    @Query('slot') slot?: string,
  ) {
    const activeBool = active === undefined ? undefined : active === 'true';
    const slotNum = slot === undefined ? undefined : Number(slot);
    return this.banners.listAdminRoom({
      page,
      limit,
      active: activeBool,
      slot: slotNum,
    });
  }

  @RequirePermissions(PERMISSIONS.BANNERS_VIEW)
  @Get('room/:id')
  async getRoom(@Param('id') id: string) {
    const banner = await this.banners.getRoomOrThrow(id);
    return { banner };
  }

  @RequirePermissions(PERMISSIONS.BANNERS_MANAGE)
  @Post('room')
  async createRoom(
    @Body() dto: CreateRoomBannerDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    const banner = await this.banners.createRoom(dto, admin.adminId);
    return { banner };
  }

  @RequirePermissions(PERMISSIONS.BANNERS_MANAGE)
  @Patch('room/:id')
  async updateRoom(@Param('id') id: string, @Body() dto: UpdateRoomBannerDto) {
    const banner = await this.banners.updateRoom(id, dto);
    return { banner };
  }

  @RequirePermissions(PERMISSIONS.BANNERS_MANAGE)
  @Delete('room/:id')
  async deleteRoom(@Param('id') id: string) {
    await this.banners.deleteRoom(id);
    return { ok: true };
  }
}
