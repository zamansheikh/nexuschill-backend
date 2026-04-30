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
import { CreateSvipTierDto, UpdateSvipTierDto } from './dto/svip-tier.dto';
import { SvipService } from './svip.service';

@Controller({ path: 'admin/svip', version: '1' })
@AdminOnly()
export class SvipAdminController {
  constructor(private readonly svip: SvipService) {}

  /**
   * The static catalog of privilege keys, grouped by category. Used by the
   * admin UI when editing a tier so admins can pick from a known list.
   */
  @RequirePermissions(PERMISSIONS.VIP_VIEW)
  @Get('privileges')
  async listPrivileges() {
    return { items: this.svip.listPrivileges() };
  }

  @RequirePermissions(PERMISSIONS.VIP_VIEW)
  @Get('tiers')
  async listTiers(@Query('activeOnly') activeOnly?: string) {
    const items = await this.svip.listTiers(activeOnly === 'true');
    return { items };
  }

  @RequirePermissions(PERMISSIONS.VIP_VIEW)
  @Get('tiers/:id')
  async getTier(@Param('id') id: string) {
    const tier = await this.svip.getByIdOrThrow(id);
    return { tier };
  }

  @RequirePermissions(PERMISSIONS.VIP_MANAGE)
  @Post('tiers')
  async createTier(@Body() dto: CreateSvipTierDto) {
    const tier = await this.svip.create(dto);
    return { tier };
  }

  @RequirePermissions(PERMISSIONS.VIP_MANAGE)
  @Patch('tiers/:id')
  async updateTier(@Param('id') id: string, @Body() dto: UpdateSvipTierDto) {
    const tier = await this.svip.update(id, dto);
    return { tier };
  }

  @RequirePermissions(PERMISSIONS.VIP_MANAGE)
  @Delete('tiers/:id')
  async deleteTier(@Param('id') id: string) {
    await this.svip.softDelete(id);
    return { ok: true };
  }
}
