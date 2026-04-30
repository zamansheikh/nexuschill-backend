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
import {
  CreateExchangeOptionDto,
  CreateRechargePackageDto,
  UpdateExchangeOptionDto,
  UpdateRechargePackageDto,
} from './dto/wallet-options.dto';
import { WalletOptionsService } from './wallet-options.service';

/**
 * Admin CRUD for the two wallet-related lists. Both reuse the existing
 * recharge / wallet permissions:
 *
 *   • Recharge packages → `RECHARGE_PACKAGE_MANAGE` (already in catalog)
 *   • Exchange options  → `WALLET_ADJUST` (it's a money-controls surface,
 *     same gate as freeze / mint)
 */
@Controller({ path: 'admin/wallet-options', version: '1' })
@AdminOnly()
export class AdminWalletOptionsController {
  constructor(private readonly options: WalletOptionsService) {}

  // ---------- Recharge packages ----------

  @RequirePermissions(PERMISSIONS.RECHARGE_VIEW)
  @Get('recharge-packages')
  async listPackages(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('active') active?: string,
  ) {
    const activeBool = active === undefined ? undefined : active === 'true';
    return this.options.listAdminPackages({ page, limit, active: activeBool });
  }

  @RequirePermissions(PERMISSIONS.RECHARGE_VIEW)
  @Get('recharge-packages/:id')
  async getPackage(@Param('id') id: string) {
    const pkg = await this.options.getPackageOrThrow(id);
    return { package: pkg };
  }

  @RequirePermissions(PERMISSIONS.RECHARGE_PACKAGE_MANAGE)
  @Post('recharge-packages')
  async createPackage(
    @Body() dto: CreateRechargePackageDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    const pkg = await this.options.createPackage(dto, admin.adminId);
    return { package: pkg };
  }

  @RequirePermissions(PERMISSIONS.RECHARGE_PACKAGE_MANAGE)
  @Patch('recharge-packages/:id')
  async updatePackage(
    @Param('id') id: string,
    @Body() dto: UpdateRechargePackageDto,
  ) {
    const pkg = await this.options.updatePackage(id, dto);
    return { package: pkg };
  }

  @RequirePermissions(PERMISSIONS.RECHARGE_PACKAGE_MANAGE)
  @Delete('recharge-packages/:id')
  async deletePackage(@Param('id') id: string) {
    await this.options.deletePackage(id);
    return { ok: true };
  }

  // ---------- Exchange options ----------

  @RequirePermissions(PERMISSIONS.WALLET_VIEW)
  @Get('exchange-options')
  async listExchangeOptions(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('active') active?: string,
  ) {
    const activeBool = active === undefined ? undefined : active === 'true';
    return this.options.listAdminExchangeOptions({ page, limit, active: activeBool });
  }

  @RequirePermissions(PERMISSIONS.WALLET_VIEW)
  @Get('exchange-options/:id')
  async getExchangeOption(@Param('id') id: string) {
    const option = await this.options.getExchangeOptionOrThrow(id);
    return { option };
  }

  @RequirePermissions(PERMISSIONS.WALLET_ADJUST)
  @Post('exchange-options')
  async createExchangeOption(
    @Body() dto: CreateExchangeOptionDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    const option = await this.options.createExchangeOption(dto, admin.adminId);
    return { option };
  }

  @RequirePermissions(PERMISSIONS.WALLET_ADJUST)
  @Patch('exchange-options/:id')
  async updateExchangeOption(
    @Param('id') id: string,
    @Body() dto: UpdateExchangeOptionDto,
  ) {
    const option = await this.options.updateExchangeOption(id, dto);
    return { option };
  }

  @RequirePermissions(PERMISSIONS.WALLET_ADJUST)
  @Delete('exchange-options/:id')
  async deleteExchangeOption(@Param('id') id: string) {
    await this.options.deleteExchangeOption(id);
    return { ok: true };
  }
}
