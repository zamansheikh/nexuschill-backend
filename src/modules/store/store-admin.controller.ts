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
import { RequirePermissions } from '../admin/admin-auth/decorators/require-permissions.decorator';
import { PERMISSIONS } from '../admin/permissions.catalog';
import {
  CreateStoreListingDto,
  UpdateStoreListingDto,
} from './dto/store-listing.dto';
import { StoreCategory } from './schemas/store-listing.schema';
import { StoreService } from './store.service';

@Controller({ path: 'admin/store', version: '1' })
@AdminOnly()
export class StoreAdminController {
  constructor(private readonly store: StoreService) {}

  @RequirePermissions(PERMISSIONS.STORE_VIEW)
  @Get('listings')
  async list(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('category') category?: StoreCategory,
    @Query('active') active?: string,
    @Query('featured') featured?: string,
  ) {
    const activeBool = active === undefined ? undefined : active === 'true';
    const featuredBool = featured === undefined ? undefined : featured === 'true';
    return this.store.listAdmin({
      page,
      limit,
      category,
      active: activeBool,
      featured: featuredBool,
    });
  }

  @RequirePermissions(PERMISSIONS.STORE_VIEW)
  @Get('listings/:id')
  async getOne(@Param('id') id: string) {
    const listing = await this.store.getByIdOrThrow(id);
    return { listing };
  }

  @RequirePermissions(PERMISSIONS.STORE_MANAGE)
  @Post('listings')
  async create(@Body() dto: CreateStoreListingDto) {
    const listing = await this.store.create(dto);
    return { listing };
  }

  @RequirePermissions(PERMISSIONS.STORE_MANAGE)
  @Patch('listings/:id')
  async update(@Param('id') id: string, @Body() dto: UpdateStoreListingDto) {
    const listing = await this.store.update(id, dto);
    return { listing };
  }

  @RequirePermissions(PERMISSIONS.STORE_MANAGE)
  @Delete('listings/:id')
  async remove(@Param('id') id: string) {
    await this.store.softDelete(id);
    return { ok: true };
  }
}
