import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';

import { AdminOnly } from '../admin/admin-auth/decorators/admin-only.decorator';
import { CurrentAdmin } from '../admin/admin-auth/decorators/current-admin.decorator';
import { RequirePermissions } from '../admin/admin-auth/decorators/require-permissions.decorator';
import { AuthenticatedAdmin } from '../admin/admin-auth/strategies/admin-jwt.strategy';
import { PERMISSIONS } from '../admin/permissions.catalog';
import { CreateGiftDto, UpdateGiftDto } from './dto/gift.dto';
import { GiftsService } from './gifts.service';
import { GiftCategory } from './schemas/gift.schema';

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
}
